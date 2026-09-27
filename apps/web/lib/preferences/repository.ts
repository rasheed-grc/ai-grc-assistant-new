/** `user_preferences` (0031). Node-only. */

import { getPool } from "@/lib/db/pool";
import { DEFAULT_PREFERENCES, type PreferenceLocale, type UserPreferences } from "./types";

interface PreferencesRow {
  locale: PreferenceLocale | null;
  timezone: string;
  notify_approvals: boolean;
  notify_mission_failures: boolean;
  notify_team: boolean;
  notifications_seen_at: Date | null;
}

function toPreferences(row: PreferencesRow): UserPreferences {
  return {
    locale: row.locale,
    timezone: row.timezone,
    notifications: {
      approvals: row.notify_approvals,
      missionFailures: row.notify_mission_failures,
      team: row.notify_team,
    },
    notificationsSeenAt: row.notifications_seen_at?.toISOString() ?? null,
  };
}

export type PreferencesPatch = Partial<{
  locale: PreferenceLocale;
  timezone: string;
  notifications: Partial<UserPreferences["notifications"]>;
}>;

export const preferencesRepository = {
  async get(userId: string): Promise<UserPreferences> {
    const { rows } = await getPool().query<PreferencesRow>(
      `SELECT locale, timezone, notify_approvals, notify_mission_failures, notify_team,
              notifications_seen_at
         FROM user_preferences WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ? toPreferences(rows[0]) : DEFAULT_PREFERENCES;
  },

  /** Upserts only the fields present in `patch`; everything else keeps its stored/default value. */
  async update(userId: string, patch: PreferencesPatch): Promise<UserPreferences> {
    const current = await this.get(userId);
    const next = {
      locale: patch.locale ?? current.locale,
      timezone: patch.timezone ?? current.timezone,
      notifications: { ...current.notifications, ...patch.notifications },
    };
    await getPool().query(
      `INSERT INTO user_preferences
         (user_id, locale, timezone, notify_approvals, notify_mission_failures, notify_team)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         locale = EXCLUDED.locale, timezone = EXCLUDED.timezone,
         notify_approvals = EXCLUDED.notify_approvals,
         notify_mission_failures = EXCLUDED.notify_mission_failures,
         notify_team = EXCLUDED.notify_team, updated_at = now()`,
      [
        userId,
        next.locale,
        next.timezone,
        next.notifications.approvals,
        next.notifications.missionFailures,
        next.notifications.team,
      ],
    );
    return { ...current, ...next };
  },

  async markNotificationsSeen(userId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO user_preferences (user_id, notifications_seen_at) VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET notifications_seen_at = now(), updated_at = now()`,
      [userId],
    );
  },
};
