/**
 * Per-user preferences and the notifications feed. The feed is DERIVED from real records — nothing
 * is generated or stored as a "notification": missions the caller can act on / that failed
 * (grc-api), and invitations still open in the organization. A category the user switched off is
 * simply not derived, so switching it back on shows what is genuinely pending again.
 */

import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { ValidationError } from "@/lib/errors";
import { invitationRepository } from "@/lib/invitations/repository";
import { listMissions } from "@/lib/missions/service";
import { preferencesRepository } from "./repository";
import {
  PREFERENCE_LOCALES,
  type NotificationItem,
  type NotificationsFeed,
  type UserPreferences,
} from "./types";

/** Newest first, capped: a bell shows what needs attention now, not a history. */
const FEED_LIMIT = 20;
/** A failure older than this is history, not news. */
const FAILURE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const updatePreferencesSchema = z
  .object({
    locale: z.enum(PREFERENCE_LOCALES),
    timezone: z.string().trim().min(1).max(64),
    notifications: z
      .object({
        approvals: z.boolean(),
        missionFailures: z.boolean(),
        team: z.boolean(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export async function getPreferences(actor: ActorContext): Promise<UserPreferences> {
  return preferencesRepository.get(actor.userId);
}

export async function updatePreferences(
  actor: ActorContext,
  input: unknown,
): Promise<UserPreferences> {
  const parsed = updatePreferencesSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid preferences.");
  }
  if (parsed.data.timezone !== undefined && !isValidTimeZone(parsed.data.timezone)) {
    throw new ValidationError("Unknown time zone.");
  }
  return preferencesRepository.update(actor.userId, parsed.data);
}

export async function markNotificationsSeen(actor: ActorContext): Promise<void> {
  await preferencesRepository.markNotificationsSeen(actor.userId);
}

export async function getNotifications(actor: ActorContext): Promise<NotificationsFeed> {
  const prefs = await preferencesRepository.get(actor.userId);
  const seenAt = prefs.notificationsSeenAt ? Date.parse(prefs.notificationsSeenAt) : 0;
  const items: NotificationItem[] = [];
  const push = (item: Omit<NotificationItem, "unread">) =>
    items.push({ ...item, unread: Date.parse(item.at) > seenAt });

  const wantsMissions = prefs.notifications.approvals || prefs.notifications.missionFailures;
  if (wantsMissions && can(actor.roles, "read", "mission")) {
    // A grc-api outage must not blank the whole bell: mission items are skipped, team items stay.
    const missions = await listMissions(actor).catch(() => []);
    for (const mission of missions) {
      if (prefs.notifications.approvals && mission.awaitingApproval && can(actor.roles, "approve", "mission")) {
        push({
          id: `approval:${mission.id}`,
          category: "approvals",
          subject: mission.scope,
          missionType: mission.type,
          href: `/missions/${mission.id}`,
          at: mission.updatedAt,
        });
      } else if (
        prefs.notifications.missionFailures &&
        mission.status === "failed" &&
        Date.now() - Date.parse(mission.updatedAt) < FAILURE_WINDOW_MS
      ) {
        push({
          id: `failed:${mission.id}`,
          category: "missionFailures",
          subject: mission.scope,
          missionType: mission.type,
          href: `/missions/${mission.id}`,
          at: mission.updatedAt,
        });
      }
    }
  }

  if (prefs.notifications.team && actor.roles.some((r) => r === "owner" || r === "admin")) {
    for (const invite of await invitationRepository.listPendingForOrganization(actor.tenantId)) {
      push({
        id: `invite:${invite.id}`,
        category: "team",
        subject: invite.email,
        missionType: null,
        href: "/settings",
        at: invite.createdAt,
      });
    }
  }

  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const page = items.slice(0, FEED_LIMIT);
  return { items: page, unreadCount: page.filter((i) => i.unread).length };
}
