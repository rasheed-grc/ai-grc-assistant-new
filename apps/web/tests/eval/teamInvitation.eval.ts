/**
 * Integration check for team invitations (owner/admin inviting a colleague into their
 * *existing* organization, as opposed to the original KI-P9 flow where accepting an
 * invitation always creates a brand-new one) — no mocking, exercises the real
 * Postgres-backed services directly.
 *
 * Requires apps/web's live Postgres reachable via `DATABASE_URL` with migrations applied
 * (`npm run db:migrate`). Skips with a clear message rather than failing when it isn't set —
 * the same convention accessOnboarding.eval.ts uses.
 *
 * Run directly: `pnpm --filter @grc/web exec tsx tests/eval/teamInvitation.eval.ts`
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
      "SKIP teamInvitation.eval — DATABASE_URL is not set (checked apps/web/.env.local and root .env).",
    );
    return;
  }

  const { getPool } = await import("../../lib/db/pool");
  const { createOrganization, inviteTeamMember } = await import("../../lib/organizations/service");
  const { organizationRepository } = await import("../../lib/organizations/repository");
  const { acceptInvitation } = await import("../../lib/invitations/service");
  const { approveAccessRequestSchema } = await import("../../lib/accessRequests/service");

  const runId = randomUUID().slice(0, 8);
  const ownerUserId = `e2e-team-owner-${runId}`;
  const cleanupEmails: string[] = [];
  let orgAId: string | null = null;
  let orgBId: string | null = null;

  function ownerActor(tenantId: string, organizationName = "E2E Team Owner Org"): ActorContext {
    return {
      userId: ownerUserId,
      userName: "E2E Team Owner",
    userEmail: "eval@test.local",
      tenantId,
      organizationName,
      roles: ["owner"],
      apiToken: "unused",
    };
  }

  function memberActor(tenantId: string, organizationName = "E2E Team Member Org"): ActorContext {
    return {
      userId: `e2e-team-member-${runId}`,
      userName: "E2E Team Member",
    userEmail: "eval@test.local",
      tenantId,
      organizationName,
      roles: ["analyst"],
      apiToken: "unused",
    };
  }

  try {
    // Two real, separate organizations — org A is where we invite into; org B exists only to
    // prove an org A invite can never be scoped to it.
    const orgA = await createOrganization(ownerActor("unused"), {
      name: `E2E Team Org A ${runId}`,
      orgType: "Enterprise",
      industry: "Technology",
    });
    orgAId = orgA.id;
    const orgB = await createOrganization(ownerActor("unused"), {
      name: `E2E Team Org B ${runId}`,
      orgType: "Enterprise",
      industry: "Technology",
    });
    orgBId = orgB.id;

    const inviteEmail = `e2e-team-invitee-${runId}@team-invitation.test`;
    cleanupEmails.push(inviteEmail);

    // 1. Owner inviting a member succeeds, and the invite is scoped to org A only.
    const invited = await inviteTeamMember(
      ownerActor(orgAId),
      { email: inviteEmail, invitedRole: "member" },
      "http://localhost:3000",
    );
    assert(
      invited.invitation.organizationId === orgAId,
      "a team invite must be scoped to the inviter's own organization",
    );
    assert(
      invited.invitation.organizationId !== orgBId,
      "a team invite must never leak into a different organization",
    );
    assert(invited.token.length >= 32, "the raw invite token must be a real random value");

    // 2. A non-owner/admin (analyst) cannot invite.
    await assertThrows(
      () =>
        inviteTeamMember(
          memberActor(orgAId!),
          { email: `e2e-team-blocked-${runId}@team-invitation.test`, invitedRole: "member" },
          "http://localhost:3000",
        ),
      "a member/analyst-role actor must not be able to invite teammates",
    );

    // 3. Invalid invitedRole is rejected outright — never silently falls back to "owner".
    await assertThrows(
      () =>
        inviteTeamMember(
          ownerActor(orgAId!),
          { email: `e2e-team-badrole-${runId}@team-invitation.test`, invitedRole: "viewer" },
          "http://localhost:3000",
        ),
      "an invalid invitedRole must be rejected, not silently substituted",
    );
    // Same fix applies to the original access-request approval path.
    const badRoleParse = approveAccessRequestSchema.safeParse({ invitedRole: "viewer" });
    assert(!badRoleParse.success, "approveAccessRequestSchema must reject an invalid role too");

    // 4. Accepting the invite adds the user to the EXISTING organization A — no new org, no
    // leak into org B.
    const orgCountBefore = await countOrganizationRows(orgAId!);
    const accepted = await acceptInvitation(invited.token, {
      name: "E2E Invitee",
      password: "correct horse battery staple",
    });
    assert(
      accepted.organizationId === orgAId,
      `accepting a team invite must join the existing org (expected ${orgAId}, got ${accepted.organizationId})`,
    );
    assert(accepted.role === "analyst", "invitedRole 'member' must map to the 'analyst' UserRole");
    const orgCountAfter = await countOrganizationRows(orgAId!);
    assert(
      orgCountAfter === orgCountBefore,
      "accepting a team invite must not create a new organizations row",
    );
    const membership = await organizationRepository.getMembership(accepted.userId, orgAId!);
    assert(membership !== null, "the accepted user must be a real member of org A");
    const membershipInOrgB = await organizationRepository.getMembership(accepted.userId, orgBId!);
    assert(membershipInOrgB === null, "the accepted user must NOT be a member of org B");

    // 5. Tenant isolation, once more from the read side: org A's member listing must include
    // the new teammate; org B's must not.
    const members = await organizationRepository.listMembers(orgAId!);
    assert(
      members.some((m) => m.userId === accepted.userId),
      "org A's member list must include the newly-joined teammate",
    );
    const membersB = await organizationRepository.listMembers(orgBId!);
    assert(
      !membersB.some((m) => m.userId === accepted.userId),
      "org B's member list must NOT include org A's teammate",
    );

    console.log("PASS teamInvitation.eval — all checks passed.");
  } finally {
    const pool = getPool();
    await pool.query(`DELETE FROM invitations WHERE lower(email) = ANY($1)`, [
      cleanupEmails.map((e) => e.toLowerCase()),
    ]);
    await pool.query(`DELETE FROM users WHERE lower(email) = ANY($1)`, [
      cleanupEmails.map((e) => e.toLowerCase()),
    ]);
    const orgIds = [orgAId, orgBId].filter((id): id is string => Boolean(id));
    if (orgIds.length > 0) {
      await pool.query(`DELETE FROM user_organizations WHERE organization_id = ANY($1)`, [orgIds]);
      await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [orgIds]);
    }
    await pool.end();
  }

  async function countOrganizationRows(organizationId: string): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM organizations WHERE id = $1`,
      [organizationId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
