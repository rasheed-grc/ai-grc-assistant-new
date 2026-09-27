/**
 * Server-side guard for the one claim the model must never get to make on its own: "this is a
 * regulatory requirement".
 *
 * The prompt asks the model to keep `isRegulatoryRequirement` false unless the recommendation is
 * grounded in an APPROVED regulatory excerpt — but a prompt is a request, not an enforcement, and a
 * live eval showed the model marking a recommendation as a legal requirement while citing an
 * excerpt still "pending review". This runs after every model response and downgrades any
 * requirement claim that does not cite (in `references` or `basis`) an `[Rn]` marker whose excerpt
 * is approved or published. Downgrading is the safe direction: the recommendation stays, labelled
 * as recommended practice, never as an unsupported legal obligation (CLAUDE.md §1 — say less, not
 * something wrong). Pure and synchronous so it is unit-testable without a model.
 */

import type { RegulationVersionStatus } from "@/lib/regulatoryReasoning/search";
import type { LlmRecommendation } from "./types";

export interface GroundingSource {
  status: RegulationVersionStatus;
}

const APPROVED = new Set<RegulationVersionStatus>(["approved", "published"]);
const MARKER = /\[R(\d+)\]/g;

/** The `[Rn]` markers in `text` that point at an approved excerpt (`hits[n - 1]`, matching how the
 * prompt numbers them). */
function approvedMarkersIn(text: string, hits: readonly GroundingSource[]): number {
  let count = 0;
  for (const match of text.matchAll(MARKER)) {
    const hit = hits[Number(match[1]) - 1];
    if (hit && APPROVED.has(hit.status)) count += 1;
  }
  return count;
}

export function enforceRegulatoryGrounding(
  recommendations: LlmRecommendation[],
  hits: readonly GroundingSource[],
): LlmRecommendation[] {
  return recommendations.map((rec) => {
    if (!rec.isRegulatoryRequirement) return rec;
    const cited = [rec.basis, ...rec.references].join(" ");
    return approvedMarkersIn(cited, hits) > 0 ? rec : { ...rec, isRegulatoryRequirement: false };
  });
}
