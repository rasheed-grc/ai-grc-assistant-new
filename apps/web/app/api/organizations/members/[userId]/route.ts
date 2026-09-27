import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { removeTeamMember } from "@/lib/organizations/service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/** Removes a teammate from the caller's current organization. Owner/admin only, enforced in the
 * service (never trusts an organization id from the request — the org is the actor's own). */
export async function DELETE(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const { userId } = await params;
    await removeTeamMember(actor, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
