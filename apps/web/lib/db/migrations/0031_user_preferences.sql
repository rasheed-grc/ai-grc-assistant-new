-- Per-user preferences (Settings > Preferences / Notifications). One row per user, created on the
-- first save; a missing row means "defaults" (locale unset → whichever the URL says, Riyadh time,
-- every notification category on). `notifications_seen_at` is the read marker for the bell: an
-- item is unread when it is newer than this instant.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  locale text CHECK (locale IN ('ar', 'en')),
  timezone text NOT NULL DEFAULT 'Asia/Riyadh',
  notify_approvals boolean NOT NULL DEFAULT true,
  notify_mission_failures boolean NOT NULL DEFAULT true,
  notify_team boolean NOT NULL DEFAULT true,
  notifications_seen_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
