/** Browser-side Policy Recommendations API client. */

import type { Policy } from "@/lib/policies/types";
import type { PolicyRecommendation } from "./types";

async function parseError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${response.status}).`;
}

export async function fetchRecommendations(): Promise<PolicyRecommendation[]> {
  const response = await fetch("/api/policy-recommendations", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { recommendations: PolicyRecommendation[] }).recommendations;
}

/** Runs a fresh grounded analysis — can take a while (a real LLM call). */
export async function generateRecommendations(): Promise<PolicyRecommendation[]> {
  const response = await fetch("/api/policy-recommendations", { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { recommendations: PolicyRecommendation[] }).recommendations;
}

export async function draftFromRecommendation(
  id: string,
): Promise<{ recommendation: PolicyRecommendation; policy: Policy }> {
  const response = await fetch(`/api/policy-recommendations/${id}/draft`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { recommendation: PolicyRecommendation; policy: Policy };
}

export async function dismissRecommendation(id: string): Promise<PolicyRecommendation> {
  const response = await fetch(`/api/policy-recommendations/${id}/dismiss`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { recommendation: PolicyRecommendation }).recommendation;
}
