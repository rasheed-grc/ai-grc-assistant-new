import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_TTL_SECONDS, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/config";
import { verifyPassword } from "@/lib/auth/password";
import { checkRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { signSession } from "@/lib/auth/session";
import { toSessionUser, type SessionPayload } from "@/lib/auth/types";
import { authRepository } from "@/lib/auth/users";
import { preferencesRepository } from "@/lib/preferences/repository";

// scrypt requires the Node.js runtime (not edge).
export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
});

const INVALID_CREDENTIALS = "Invalid email or password.";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  const { email, password } = parsed.data;

  // Throttle by client + email to slow credential stuffing without blocking real users.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = `${ip}:${email.toLowerCase()}`;
  const limit = await checkRateLimit(rateKey);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const user = await authRepository.findByEmail(email);
  // Always run a verification to keep timing uniform whether or not the user exists.
  const passwordOk = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, "scrypt$16384$8$1$00$00");

  if (!user || !passwordOk) {
    // Generic message — never reveal which factor failed (no user enumeration).
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  await resetRateLimit(rateKey);

  const payload: SessionPayload = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    initials: user.initials,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    roles: user.roles,
    apiToken: user.apiToken,
  };
  const token = await signSession(payload);

  // The saved language (Settings > Preferences) follows the person to any device; the login form
  // navigates to it. A preferences read failing must never block signing in.
  const preferredLocale = await preferencesRepository
    .get(user.userId)
    .then((p) => p.locale)
    .catch(() => null);

  const response = NextResponse.json({ user: toSessionUser(payload), locale: preferredLocale });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS));
  return response;
}
