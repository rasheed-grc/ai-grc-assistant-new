import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { getMission } from "@/lib/missions/service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** One mission's full detail — the review station's plan, and progress once it has run. Never
 * another tenant's: `getMission` derives the tenant from the actor's own signed service token,
 * and grc-api's read model is itself tenant-scoped underneath that (CLAUDE.md §20). */
export async function GET(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const { id } = await params;
    const mission = await getMission(actor, id);
    return NextResponse.json({ mission });
  } catch (error) {
    return errorResponse(error);
  }
}
