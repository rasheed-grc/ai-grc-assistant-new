import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { generateRecommendations, listRecommendations } from "@/lib/policyRecommendations/service";

export const runtime = "nodejs";
// A real grounded LLM call (context gathering + generation, possibly one retry) can take a while.
export const maxDuration = 120;

export async function GET(): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const recommendations = await listRecommendations(actor);
    return NextResponse.json({ recommendations });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Runs a fresh "Analyze Policy Needs" pass — replaces the tenant's `pending` recommendations. */
export async function POST(): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    const locale = await getRequestLocale();
    const recommendations = await generateRecommendations(actor, locale);
    return NextResponse.json({ recommendations }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
