/**
 * Server-only session helpers for Server Components and Route Handlers. Reads the httpOnly
 * cookie via `next/headers`, so this must never be imported by client components or
 * middleware. Pairs with the edge `middleware.ts` (the primary gate) as defense-in-depth.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import {
  ACCESS_DENIED_PATH,
  LOGIN_PATH,
  SESSION_COOKIE,
  STALE_SESSION_PARAM,
  STALE_SESSION_VALUE,
} from "./config";
import { can, type Action, type ResourceType } from "./permissions";
import { isUserRole, type UserRole } from "./roles";
import { organizationRepository } from "@/lib/organizations/repository";
import { verifySessionToken } from "./session";
import { toSessionUser } from "./types";
import type { SessionPayload, SessionUser } from "./types";

/**
 * A valid signature only proves the cookie was issued to this person once. It says nothing about
 * whether they are STILL a member of the organization it names, or still hold the role it carries —
 * so removing a teammate (or changing their role) would otherwise do nothing until their cookie
 * expired days later. Every session read therefore re-checks membership against the database
 * (one indexed lookup, memoized per request) and takes the role and organization name from the
 * membership row, not the cookie. No membership → no session (default deny, CLAUDE.md §20).
 */
const resolveSession = cache(async (token: string): Promise<SessionPayload | null> => {
  const session = await verifySessionToken(token);
  if (!session) return null;
  const membership = await organizationRepository.getMembership(
    session.userId,
    session.organizationId,
  );
  // Unknown role string → no session (fail safe; login already refuses these, users.ts).
  if (!membership || !isUserRole(membership.role)) return null;
  return {
    ...session,
    organizationName: membership.name,
    roles: [membership.role],
  };
});

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(token);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session ? toSessionUser(session) : null;
}

/** Returns the session or redirects to login, preserving the intended destination. */
export async function requireSession(nextPath?: string): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    const locale = await getLocale();
    const params = new URLSearchParams();
    if (nextPath) params.set("next", nextPath);
    // A signed cookie whose membership is gone (removed teammate, deleted organization) still
    // passes the edge middleware, which would bounce /login straight back here forever. The flag
    // tells the middleware to clear that cookie instead.
    if ((await cookies()).get(SESSION_COOKIE)?.value) {
      params.set(STALE_SESSION_PARAM, STALE_SESSION_VALUE);
    }
    const query = params.toString();
    redirect({ href: query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH, locale });
  }
  return session;
}

/** Requires at least one of `roles`; otherwise redirects to the access-denied page. */
export async function requireRoles(...roles: UserRole[]): Promise<SessionPayload> {
  const session = await requireSession();
  if (!roles.some((role) => session.roles.includes(role))) {
    const locale = await getLocale();
    redirect({ href: ACCESS_DENIED_PATH, locale });
  }
  return session;
}

/** Requires permission for `action` on `resource`; otherwise redirects to access-denied. */
export async function requirePermission(
  action: Action,
  resource: ResourceType,
): Promise<SessionPayload> {
  const session = await requireSession();
  if (!can(session.roles, action, resource)) {
    const locale = await getLocale();
    redirect({ href: ACCESS_DENIED_PATH, locale });
  }
  return session;
}
