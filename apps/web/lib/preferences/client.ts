/** Browser-side preferences + notifications API client. */

import type { NotificationsFeed, UserPreferences } from "./types";

async function parseError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${response.status}).`;
}

export async function fetchPreferences(): Promise<UserPreferences> {
  const response = await fetch("/api/account/preferences", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { preferences: UserPreferences }).preferences;
}

export type PreferencesInput = Partial<{
  locale: "ar" | "en";
  timezone: string;
  notifications: Partial<UserPreferences["notifications"]>;
}>;

export async function savePreferences(input: PreferencesInput): Promise<UserPreferences> {
  const response = await fetch("/api/account/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { preferences: UserPreferences }).preferences;
}

export async function fetchNotifications(): Promise<NotificationsFeed> {
  const response = await fetch("/api/account/notifications", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as NotificationsFeed;
}

export async function markNotificationsRead(): Promise<void> {
  const response = await fetch("/api/account/notifications", { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
}
