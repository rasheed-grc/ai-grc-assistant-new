/**
 * Auth configuration shared by the edge middleware, route handlers, and server helpers.
 * Must stay edge-safe (no Node-only imports) so `middleware.ts` can import it.
 */

import { logger } from "@/lib/observability/logger";

export const SESSION_COOKIE = "grc_session";

/** Session lifetime. Kept deliberately short for an enterprise security posture. */
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export const LOGIN_PATH = "/login";

/** Query flag on the login URL meaning "the cookie you hold is no longer a valid session". */
export const STALE_SESSION_PARAM = "session";
export const STALE_SESSION_VALUE = "ended";
export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";
export const ACCESS_DENIED_PATH = "/access-denied";

/**
 * Public marketing routes (V2) — reachable without a session. Kept as an exact-match
 * allowlist rather than a prefix rule so every future authenticated route stays gated by
 * default (CLAUDE.md §10/§20 — default deny).
 */
export const PUBLIC_MARKETING_PATHS = [
  "/",
  "/about",
  "/features",
  "/frameworks-supported",
  "/how-it-works",
  "/sample-reports",
  "/faq",
  "/contact",
  "/request-access",
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
] as const;
export const JWT_ISSUER = "grc-web";

/**
 * Dev-only fallback so the app runs locally without extra setup. In production a real
 * `AUTH_SECRET` (32+ random bytes) is mandatory — `getAuthSecret()` throws without it.
 */
const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-change-me-in-production-0000000000";

let warnedAboutFallback = false;

export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is required in production and must be at least 32 characters. " +
        "Generate one with: openssl rand -base64 48",
    );
  }
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    logger.warn("auth_secret_fallback", {
      detail: "AUTH_SECRET not set — using an insecure dev fallback. Never use in production.",
    });
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

/** Cookie flags applied wherever the session cookie is written or cleared. */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
