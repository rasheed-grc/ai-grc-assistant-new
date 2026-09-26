import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { runMission } from "@/lib/missions/service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Executes a reviewed mission. A repeat call on an already-started mission is a 409, mapped to
 * `ConflictError` by the service — the UI treats that as "already running", not an error. */
export async function POST(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const { id } = await params;
    const result = await runMission(actor, id);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
