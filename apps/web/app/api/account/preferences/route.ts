import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { errorResponse, unauthorized } from "@/lib/api/respond";
import { getPreferences, updatePreferences } from "@/lib/preferences/service";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    return NextResponse.json({ preferences: await getPreferences(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const actor = await getActor();
    if (!actor) return unauthorized();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
    }
    return NextResponse.json({ preferences: await updatePreferences(actor, body) });
  } catch (error) {
    return errorResponse(error);
  }
}
