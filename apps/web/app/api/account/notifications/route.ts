import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { getNotifications, markNotificationsSeen } from "@/lib/preferences/service";

export const runtime = "nodejs";

/** The caller's notifications, derived from real missions / invitations (never stored). */
export async function GET(): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    return NextResponse.json(await getNotifications(actor));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Marks everything currently shown as read. */
export async function POST(): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    await markNotificationsSeen(actor);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
