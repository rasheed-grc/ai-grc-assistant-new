import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, sessionCookieOptions, SESSION_TTL_SECONDS } from "@/lib/auth/config";
import { getActor } from "@/lib/auth/actor";
import { getSession } from "@/lib/auth/server";
import { signSession } from "@/lib/auth/session";
import { isUserRole } from "@/lib/auth/roles";
import { toSessionUser, type SessionPayload } from "@/lib/auth/types";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { assertMembership } from "@/lib/organizations/service";

export const runtime = "nodejs";

const switchSchema = z.object({ organizationId: z.string().trim().min(1) });

/**
 * Switches the active organization for the current session. Re-issues the signed session
 * cookie rather than mutating anything server-side — every tenant-scoped repository reads
 * `organizationId` off this cookie (via `getActor().tenantId`), so nothing else needs to
 * change for data to isolate per company.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await getActor();
    const session = await getSession();
    if (!actor || !session) return unauthorized();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
    }
    const parsed = switchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("An organization id is required.");
    }

    const membership = await assertMembership(actor, parsed.data.organizationId);

    // Fail safe: a membership whose role is not a known role never becomes an owner session.
    if (!isUserRole(membership.role)) {
      throw new ValidationError("Your role in that organization is not recognised.");
    }
    const nextPayload: SessionPayload = {
      ...session,
      organizationId: membership.id,
      organizationName: membership.name,
      roles: [membership.role],
    };
    const token = await signSession(nextPayload);

    const response = NextResponse.json({ user: toSessionUser(nextPayload) });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_SECONDS));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
