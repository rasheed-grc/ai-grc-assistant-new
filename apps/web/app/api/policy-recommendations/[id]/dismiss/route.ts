import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { dismissRecommendation } from "@/lib/policyRecommendations/service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteContext): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const { id } = await params;
    const recommendation = await dismissRecommendation(actor, id);
    return NextResponse.json({ recommendation });
  } catch (error) {
    return errorResponse(error);
  }
}
