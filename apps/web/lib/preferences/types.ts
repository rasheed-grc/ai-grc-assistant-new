export const PREFERENCE_LOCALES = ["ar", "en"] as const;
export type PreferenceLocale = (typeof PREFERENCE_LOCALES)[number];

export const DEFAULT_TIMEZONE = "Asia/Riyadh";

export const NOTIFICATION_CATEGORIES = ["approvals", "missionFailures", "team"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface UserPreferences {
  /** null = the user never chose one; the URL's locale applies. */
  locale: PreferenceLocale | null;
  timezone: string;
  notifications: Record<NotificationCategory, boolean>;
  notificationsSeenAt: string | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  locale: null,
  timezone: DEFAULT_TIMEZONE,
  notifications: { approvals: true, missionFailures: true, team: true },
  notificationsSeenAt: null,
};

/** One derived notification. `id` is stable per underlying fact (mission + status), so it never
 * changes between polls; `at` is when that fact happened. */
export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  /** What it is about — a mission scope or an email — shown verbatim, never translated. */
  subject: string;
  /** Mission type id for mission-based items (the UI labels it), else null. */
  missionType: string | null;
  href: string;
  at: string;
  unread: boolean;
}

export interface NotificationsFeed {
  items: NotificationItem[];
  unreadCount: number;
}
