import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { ValidationError } from "@/lib/errors";
import { createMission, listMissions } from "@/lib/missions/service";
import { isStartableMissionType } from "@/lib/missions/types";

export const runtime = "nodejs";

/** Lists mission runs for the signed-in user's organization. */
export async function GET(): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();

    const missions = await listMissions(actor);
    return NextResponse.json({ missions });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Starts (creates + plans, but does not run) a new mission from the launcher catalog. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { type, scope } = (body as { type?: unknown; scope?: unknown }) ?? {};
    if (typeof type !== "string" || !isStartableMissionType(type)) {
      throw new ValidationError("Unknown or unsupported mission type.");
    }
    if (typeof scope !== "string" || scope.trim().length === 0) {
      throw new ValidationError("Tell the mission what to assess.");
    }

    const created = await createMission(actor, type, scope.trim());
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
