/**
 * Integration check for removing team members and cancelling invitations — real Postgres-backed
 * services, no mocking. Skips (like teamInvitation.eval.ts) when DATABASE_URL is not set.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { ActorContext } from "../../lib/auth/actor";

const appRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
dotenv.config({ path: path.join(appRoot, ".env.local") });
dotenv.config({ path: path.join(appRoot, "..", "..", ".env") });

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function assertThrows(fn: () => Promise<unknown>, name: string, message: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    assert((e as Error).name === name, `${message} (got ${(e as Error).name}: ${(e as Error).message})`);
    return;
  }
  throw new Error(`FAIL: ${message} (did not throw)`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP teamRemoval.eval — DATABASE_URL is not set.");
    return;
  }
  const { getPool } = await import("../../lib/db/pool");
  const { removeTeamMember, cancelInvitation, inviteTeamMember } = await import(
    "../../lib/organizations/service"
  );
  const { organizationRepository } = await import("../../lib/organizations/repository");

  const run = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const ids = {
    owner: `e2e-rm-owner-${run}`,
    owner2: `e2e-rm-owner2-${run}`,
    admin: `e2e-rm-admin-${run}`,
    member: `e2e-rm-member-${run}`,
  };
  const inviteEmail = `e2e-rm-invitee-${run}@team-removal.test`;

  const actor = (userId: string, role: string, tenantId = orgId): ActorContext => ({
    userId,
    userName: userId,
    userEmail: "eval@test.local",
    tenantId,
    organizationName: "E2E Removal Org",
    roles: [role as ActorContext["roles"][number]],
    apiToken: "unused",
  });

  const pool = getPool();
  try {
    for (const id of [orgId, otherOrgId]) {
      await pool.query(
        `INSERT INTO organizations (id, name, org_type, industry, created_by_user_id, created_at)
         VALUES ($1, $2, 'Enterprise', 'Technology', $3, now())`,
        [id, `E2E Removal ${run}`, ids.owner],
      );
    }
    await organizationRepository.addMember(ids.owner, orgId, "owner");
    await organizationRepository.addMember(ids.admin, orgId, "admin");
    await organizationRepository.addMember(ids.member, orgId, "member");
    await organizationRepository.addMember(ids.member, otherOrgId, "member");

    // 1. A plain member cannot remove anyone.
    await assertThrows(
      () => removeTeamMember(actor(ids.member, "member"), ids.admin),
      "ForbiddenError",
      "members must not be able to remove teammates",
    );
    // 2. Nobody removes themselves.
    await assertThrows(
      () => removeTeamMember(actor(ids.owner, "owner"), ids.owner),
      "ValidationError",
      "self-removal must be rejected",
    );
    // 3. The last owner cannot be removed (even by another owner-role actor).
    await assertThrows(
      () => removeTeamMember(actor(ids.owner2, "owner"), ids.owner),
      "ValidationError",
      "the last owner must be protected",
    );
    // 4. An admin cannot remove an owner.
    await assertThrows(
      () => removeTeamMember(actor(ids.admin, "admin"), ids.owner),
      "ForbiddenError",
      "an admin must not remove an owner",
    );
    // 5. Cross-organization: a non-member of this org is a 404, never a silent success.
    await assertThrows(
      () => removeTeamMember(actor(ids.owner, "owner"), `nobody-${run}`),
      "NotFoundError",
      "removing a non-member must be NotFound",
    );

    // 6. An admin removes a member: only THIS org's membership goes; the other org stays.
    await removeTeamMember(actor(ids.admin, "admin"), ids.member);
    assert(!(await organizationRepository.isMember(ids.member, orgId)), "member must lose access");
    assert(
      await organizationRepository.isMember(ids.member, otherOrgId),
      "removal must not touch the person's other organizations",
    );

    // 7. With a second owner present, an owner may remove the other owner.
    await organizationRepository.addMember(ids.owner2, orgId, "owner");
    await removeTeamMember(actor(ids.owner, "owner"), ids.owner2);
    assert(!(await organizationRepository.isMember(ids.owner2, orgId)), "second owner removed");

    // 8. Invitation cancel: works once, is scoped to the caller's org, and 404s afterwards.
    const invited = await inviteTeamMember(
      actor(ids.owner, "owner"),
      { email: inviteEmail, invitedRole: "member" },
      "http://localhost:3000",
    );
    await assertThrows(
      () => cancelInvitation(actor(ids.owner, "owner", otherOrgId), invited.invitation.id),
      "NotFoundError",
      "an invitation of another organization must not be cancellable",
    );
    await assertThrows(
      () => cancelInvitation(actor(ids.member, "member"), invited.invitation.id),
      "ForbiddenError",
      "members must not cancel invitations",
    );
    await cancelInvitation(actor(ids.owner, "owner"), invited.invitation.id);
    await assertThrows(
      () => cancelInvitation(actor(ids.owner, "owner"), invited.invitation.id),
      "NotFoundError",
      "cancelling twice must 404",
    );

    console.log("PASS teamRemoval.eval — 8 scenarios");
  } finally {
    await pool.query(`DELETE FROM invitations WHERE lower(email) = $1`, [inviteEmail]);
    await pool.query(`DELETE FROM user_organizations WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
