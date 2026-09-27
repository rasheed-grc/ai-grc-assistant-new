/**
 * Deterministic check (no model, no network) of the server-side guard that stops a policy
 * recommendation from being labelled a regulatory requirement unless it cites an APPROVED excerpt.
 * Exists because the live-model eval showed the prompt alone is not an enforcement.
 */

import { enforceRegulatoryGrounding } from "../../lib/policyRecommendations/grounding";
import type { LlmRecommendation } from "../../lib/policyRecommendations/types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function rec(over: Partial<LlmRecommendation>): LlmRecommendation {
  return {
    category: "general",
    title: "t",
    reason: "r",
    priority: "high",
    isRegulatoryRequirement: true,
    basis: "b",
    practicalGuidance: "g",
    recommendedContents: ["c"],
    references: [],
    ...over,
  } as LlmRecommendation;
}

const hits = [{ status: "in_review" as const }, { status: "approved" as const }, { status: "published" as const }];

const [pending, approved, published, uncited, practice, inBasis, outOfRange] = enforceRegulatoryGrounding(
  [
    rec({ references: ["[R1] pending law"] }),
    rec({ references: ["[R2] approved law"] }),
    rec({ references: ["[R3]"] }),
    rec({ references: ["ISO 27001"] }),
    rec({ isRegulatoryRequirement: false, references: [] }),
    rec({ basis: "Required by [R2] art. 4", references: [] }),
    rec({ references: ["[R9]"] }),
  ],
  hits,
) as [LlmRecommendation, LlmRecommendation, LlmRecommendation, LlmRecommendation, LlmRecommendation, LlmRecommendation, LlmRecommendation];

assert(pending.isRegulatoryRequirement === false, "citing only a pending-review excerpt must be downgraded");
assert(approved.isRegulatoryRequirement === true, "citing an approved excerpt keeps the requirement label");
assert(published.isRegulatoryRequirement === true, "citing a published excerpt keeps the requirement label");
assert(uncited.isRegulatoryRequirement === false, "a requirement claim citing no [Rn] marker must be downgraded");
assert(practice.isRegulatoryRequirement === false, "practice stays practice");
assert(inBasis.isRegulatoryRequirement === true, "an approved marker in `basis` counts");
assert(outOfRange.isRegulatoryRequirement === false, "a marker pointing at no excerpt must be downgraded");
assert(enforceRegulatoryGrounding([rec({})], []).every((r) => !r.isRegulatoryRequirement), "no excerpts at all -> no requirement claims");
console.log("policyRecommendationGrounding.eval: ok");
