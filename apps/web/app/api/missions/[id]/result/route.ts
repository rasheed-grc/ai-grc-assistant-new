import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { getMissionResult } from "@/lib/missions/service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** The polished Result once a mission has completed. Not-ready-yet (still running, or never
 * started) is a 409 from grc-api, mapped to `ConflictError` here — the UI reads that as "keep
 * polling the mission's progress", never as a hard failure. */
export async function GET(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const { id } = await params;
    const result = await getMissionResult(actor, id);
    return NextResponse.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
