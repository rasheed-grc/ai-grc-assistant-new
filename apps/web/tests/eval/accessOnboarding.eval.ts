/**
 * Integration check for KI-P9 (ADR-0034) invite-based onboarding — no mocking, exercises the
 * real Postgres-backed flow end to end: submit an access request, approve it (creates an
 * invitation), preview + accept the invitation (creates the organization + user), and the
 * negative paths that make the flow safe to run in production (one-time token, expiry,
 * re-reviewing an already-decided request).
 *
 * Requires apps/web's live Postgres reachable via `DATABASE_URL` with migrations applied
 * (`npm run db:migrate`). Skips with a clear message rather than failing when it isn't set.
 *
 * Run directly: `pnpm --filter @grc/web exec tsx tests/eval/accessOnboarding.eval.ts`
 * Wired into `pnpm test` via package.json.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { ActorContext } from "../../lib/auth/actor";

// This file lives at apps/web/tests/eval/ — three levels below apps/web.
const appRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
dotenv.config({ path: path.join(appRoot, ".env.local") });
dotenv.config({ path: path.join(appRoot, "..", "..", ".env") });

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function assertThrows(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log(
      "SKIP accessOnboarding.eval — DATABASE_URL is not set (checked apps/web/.env.local and root .env).",
    );
    return;
  }

  const { getPool } = await import("../../lib/db/pool");
  const { submitAccessRequest, approveAccessRequest, rejectAccessRequest } = await import(
    "../../lib/accessRequests/service"
  );
  const { previewInvitation, acceptInvitation } = await import("../../lib/invitations/service");
  const { invitationRepository } = await import("../../lib/invitations/repository");
  const { usersRepository } = await import("../../lib/users/repository");
  const { generateInviteToken, hashInviteToken } = await import("../../lib/invitations/token");

  const runId = randomUUID().slice(0, 8);
  const testEmail = `e2e-${runId}@access-onboarding.test`;
  const orgName = `E2E Test Org ${runId}`;
  const adminActor: ActorContext = {
    userId: `e2e-admin-${runId}`,
    userName: "E2E Admin",
    userEmail: "eval@test.local",
    tenantId: "e2e-admin-org",
    organizationName: "E2E Admin Org",
    roles: ["owner"],
    apiToken: "unused",
  };

  const cleanupEmails: string[] = [testEmail];
  const cleanupOrgNames: string[] = [orgName];

  try {
    // 1. Request access creation.
    const accessRequest = await submitAccessRequest({
      name: "Test Requester",
      email: testEmail,
      organizationName: orgName,
      roleTitle: "Head of Compliance",
      message: "Evaluating Rasheed for our audit cycle.",
    });
    assert(accessRequest.status === "pending", "a new access request must start pending");

    // Submitting again with the same email while pending must return the same request
    // (idempotent), not create a duplicate.
    const duplicate = await submitAccessRequest({
      name: "Test Requester",
      email: testEmail,
      organizationName: orgName,
      roleTitle: "Head of Compliance",
    });
    assert(duplicate.id === accessRequest.id, "a duplicate pending request must not be created");

    // 2. Admin approval creates an invite (and attempts to email it — Resend isn't
    // configured in this test environment, so `emailSent` is expected to be false; the
    // approval itself must still succeed, which is exactly the fail-safe behavior being
    // exercised here).
    const approval = await approveAccessRequest(
      adminActor,
      accessRequest.id,
      { invitedRole: "owner" },
      "http://localhost:3000",
    );
    assert(approval.accessRequest.status === "approved", "approval must flip status to approved");
    assert(approval.token.length >= 32, "the raw invite token must be a real random value");
    assert(
      approval.inviteLink.includes(approval.token),
      "the returned invite link must carry the raw token",
    );

    const preview = await previewInvitation(approval.token);
    assert(preview.email === testEmail, "invite preview must carry the requester's email");
    assert(preview.organizationName === orgName, "invite preview must carry the org name");
    assert(preview.invitedRole === "owner", "invite preview must carry the chosen role");

    // Approving an already-reviewed request must be rejected.
    await assertThrows(
      () =>
        approveAccessRequest(
          adminActor,
          accessRequest.id,
          { invitedRole: "owner" },
          "http://localhost:3000",
        ),
      "re-approving an already-approved request must fail",
    );

    // 3. User created successfully.
    const accepted = await acceptInvitation(approval.token, {
      name: "Test Owner",
      password: "correct horse battery staple",
    });
    assert(accepted.email === testEmail, "the created user must have the invited email");
    assert(accepted.organizationName === orgName, "the created org must have the requested name");
    const storedUser = await usersRepository.findByEmail(testEmail);
    assert(storedUser !== null, "the user must be persisted");
    assert(
      storedUser!.passwordHash.startsWith("scrypt$") && !storedUser!.passwordHash.includes(" "),
      "the password must be stored hashed, never in plaintext",
    );

    // 4. Token cannot be reused.
    await assertThrows(
      () => acceptInvitation(approval.token, { name: "Test Owner", password: "another password!" }),
      "accepting an already-used invite token must fail",
    );

    // 5. Expired token rejected.
    const expiredToken = generateInviteToken();
    const expiredEmail = `e2e-expired-${runId}@access-onboarding.test`;
    cleanupEmails.push(expiredEmail);
    await invitationRepository.create({
      id: randomUUID(),
      email: expiredEmail,
      organizationName: `E2E Expired Org ${runId}`,
      invitedRole: "member",
      tokenHash: hashInviteToken(expiredToken),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already in the past
      usedAt: null,
      accessRequestId: null,
      organizationId: null,
      createdAt: new Date().toISOString(),
    });
    await assertThrows(
      () => acceptInvitation(expiredToken, { name: "Too Late", password: "does not matter!" }),
      "accepting an expired invite token must fail",
    );

    // Reject flow, exercised separately from the approve flow above.
    const secondEmail = `e2e-reject-${runId}@access-onboarding.test`;
    cleanupEmails.push(secondEmail);
    const secondOrgName = `E2E Reject Org ${runId}`;
    cleanupOrgNames.push(secondOrgName);
    const secondRequest = await submitAccessRequest({
      name: "Test Rejectee",
      email: secondEmail,
      organizationName: secondOrgName,
      roleTitle: "Analyst",
    });
    const rejected = await rejectAccessRequest(adminActor, secondRequest.id);
    assert(rejected.status === "rejected", "rejecting a request must flip status to rejected");

    console.log("PASS accessOnboarding.eval — all checks passed.");
  } finally {
    const pool = getPool();
    await pool.query(`DELETE FROM invitations WHERE lower(email) = ANY($1)`, [
      cleanupEmails.map((e) => e.toLowerCase()),
    ]);
    await pool.query(`DELETE FROM access_requests WHERE lower(email) = ANY($1)`, [
      cleanupEmails.map((e) => e.toLowerCase()),
    ]);
    await pool.query(
      `DELETE FROM user_organizations WHERE organization_id IN (SELECT id FROM organizations WHERE name = ANY($1))`,
      [cleanupOrgNames],
    );
    await pool.query(`DELETE FROM organizations WHERE name = ANY($1)`, [cleanupOrgNames]);
    await pool.query(`DELETE FROM users WHERE lower(email) = ANY($1)`, [
      cleanupEmails.map((e) => e.toLowerCase()),
    ]);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
