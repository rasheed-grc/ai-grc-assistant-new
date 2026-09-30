/**
 * Self-service account management (post-v2.0.1 audit): the signed-in user editing their own
 * name or password — distinct from `lib/organizations` (managing *other* members) and
 * `lib/passwordReset` (an unauthenticated visitor who lost their password). Node-only.
 */

import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSession } from "@/lib/auth/session";
import type { SessionPayload } from "@/lib/auth/types";
import { AppError, ValidationError } from "@/lib/errors";
import { usersRepository } from "@/lib/users/repository";

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Your name is required.").max(200),
});

/** Updates the display name and returns a freshly signed session token carrying it — the
 * session cookie holds a copy of `name`/`initials` (see `lib/auth/types.ts`), so a bare DB
 * write would leave the UI showing the stale name until the next login. */
export async function updateProfile(
  session: SessionPayload,
  input: unknown,
): Promise<{ token: string; payload: SessionPayload }> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid name.");
  }

  const name = parsed.data.name;
  await usersRepository.updateName(session.userId, name);

  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const payload: SessionPayload = { ...session, name, initials };
  const token = await signSession(payload);
  return { token, payload };
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Your current password is required."),
  newPassword: z.string().min(10, "Password must be at least 10 characters.").max(256),
});

/** Changes the signed-in user's password. Requires the current password — self-service, not
 * an admin override — so a hijacked-but-still-open session can't be used to lock the real
 * owner out permanently. */
export async function changePassword(session: SessionPayload, input: unknown): Promise<void> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid password.");
  }

  const user = await usersRepository.findById(session.userId);
  if (!user) throw new ValidationError("Account not found.");

  const currentOk = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!currentOk) {
    // Its own code so the form can say it in the page's language.
    throw new AppError(400, "Your current password is incorrect.", "current_password_incorrect");
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await usersRepository.updatePasswordHash(session.userId, passwordHash);
}
