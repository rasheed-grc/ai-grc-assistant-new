/**
 * Integration check for per-user preferences and the derived notifications feed — real Postgres,
 * no mocking. Missions are grc-api-backed and covered live; here the team-invitation category
 * exercises derivation, unread tracking and category switches. Skips without DATABASE_URL.
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
async function rejects(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP userPreferences.eval — DATABASE_URL is not set.");
    return;
  }
  const { getPool } = await import("../../lib/db/pool");
  const { getPreferences, updatePreferences, getNotifications, markNotificationsSeen } =
    await import("../../lib/preferences/service");
  const { createInvitation } = await import("../../lib/invitations/service");

  const run = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const orgId = randomUUID();
  const email = `e2e-pref-${run}@user-preferences.test`;
  const actor = (roles: ActorContext["roles"]): ActorContext => ({
    userId,
    userName: "Pref",
    userEmail: email,
    tenantId: orgId,
    organizationName: "E2E Prefs",
    roles,
    apiToken: "unused",
  });

  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,'Pref','x',now())`,
      [userId, email],
    );
    await pool.query(
      `INSERT INTO organizations (id, name, org_type, industry, created_by_user_id, created_at)
       VALUES ($1,'E2E Prefs','Enterprise','Technology',$2,now())`,
      [orgId, userId],
    );

    // Defaults before any save.
    const defaults = await getPreferences(actor(["owner"]));
    assert(defaults.locale === null && defaults.timezone === "Asia/Riyadh", "defaults");
    assert(Object.values(defaults.notifications).every(Boolean), "all categories on by default");

    // Partial updates keep the untouched fields.
    await updatePreferences(actor(["owner"]), { locale: "en" });
    const tz = await updatePreferences(actor(["owner"]), { timezone: "Europe/London" });
    assert(tz.locale === "en" && tz.timezone === "Europe/London", "partial updates must merge");
    const notif = await updatePreferences(actor(["owner"]), { notifications: { approvals: false } });
    assert(
      !notif.notifications.approvals && notif.notifications.team && notif.timezone === "Europe/London",
      "toggling one category leaves the rest",
    );
    const reread = await getPreferences(actor(["owner"]));
    assert(reread.locale === "en" && !reread.notifications.approvals, "persisted");

    // Validation.
    await rejects(() => updatePreferences(actor(["owner"]), { timezone: "Mars/Olympus" }), "bad tz");
    await rejects(() => updatePreferences(actor(["owner"]), { locale: "fr" }), "bad locale");
    await rejects(() => updatePreferences(actor(["owner"]), { isAdmin: true }), "unknown field");

    // Derived notifications: an open invitation shows for an admin, not for a plain analyst.
    await createInvitation({
      email: `invitee-${run}@user-preferences.test`,
      organizationName: "E2E Prefs",
      invitedRole: "member",
      organizationId: orgId,
    });
    const feed = await getNotifications(actor(["owner"]));
    const invite = feed.items.filter((i) => i.category === "team");
    assert(invite.length === 1 && invite[0]!.unread && feed.unreadCount === 1, "invite is unread");
    assert(
      (await getNotifications(actor(["analyst"]))).items.every((i) => i.category !== "team"),
      "analysts do not see team invitations",
    );

    await markNotificationsSeen(actor(["owner"]));
    const seen = await getNotifications(actor(["owner"]));
    assert(seen.items.length === 1 && seen.unreadCount === 0, "marking read clears the badge only");

    await updatePreferences(actor(["owner"]), { notifications: { team: false } });
    assert((await getNotifications(actor(["owner"]))).items.length === 0, "switched-off category hidden");

    console.log("PASS userPreferences.eval");
  } finally {
    await pool.query(`DELETE FROM invitations WHERE organization_id = $1`, [orgId]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
