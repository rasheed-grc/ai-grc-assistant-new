/** Browser-side Account API client — calls this app's own routes under `/api/account/*`. */

import type { SessionUser } from "@/lib/auth/types";

async function parseError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${response.status}).`;
}

export async function updateProfileName(name: string): Promise<SessionUser> {
  const response = await fetch("/api/account/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { user: SessionUser }).user;
}

/** An Account API failure with the server's error `code`, so a form can phrase known ones itself. */
export class AccountRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const response = await fetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new AccountRequestError(
      data.error ?? `Request failed (${response.status}).`,
      data.code ?? null,
    );
  }
}
