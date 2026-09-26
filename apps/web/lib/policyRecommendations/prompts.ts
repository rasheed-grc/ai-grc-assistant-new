/**
 * Versioned prompt artifact for Policy Recommendations (CLAUDE.md §22 — prompts are named,
 * versioned files, never hardcoded inline). Every fact handed to the model is real, tenant-scoped
 * data already gathered by `service.ts` — this module only shapes it into a prompt and states the
 * rules for what may and may not be claimed.
 */

import type { ChatMessage } from "@/lib/ai";
import type { AppLocale } from "@/i18n/routing";

export const POLICY_RECOMMENDATIONS_PROMPT_VERSION = "policy_recommendations.v1";

export interface PolicyRecommendationsPromptContext {
  /** The Governance Program's own narrative of this establishment (executive summary + open
   *  plan-item rationales) — already synthesizes sector, size, and operating facts in prose. */
  establishmentNarrative: string;
  /** Top risks/gaps carried on the governance plan itself. */
  topRisksText: string;
  /** Risks from the tenant's risk register (title/category/description/severity/status). */
  registerRisksText: string;
  /** Titles + statuses of policies that already exist — never recommend a near-duplicate. */
  existingPoliciesText: string;
  /** Real regulatory excerpts found for this establishment's context (may be empty), already
   *  labeled with source type and approval status by `lib/regulatoryReasoning/search`. */
  regulatoryContextText: string;
  locale: AppLocale;
}

const RESPONSE_SHAPE = `{
  "recommendations": [
    {
      "category": "general" | "sector" | "establishment",
      "title": string,
      "reason": string,
      "priority": "critical" | "high" | "medium" | "low",
      "isRegulatoryRequirement": boolean,
      "basis": string,
      "relatedRequirementOrRisk": string (optional),
      "practicalGuidance": string,
      "recommendedContents": string[],
      "references": string[]
    }
  ]
}`;

const SYSTEM_PROMPT = `You are a senior Governance, Risk & Compliance advisor recommending which written policies
an organization needs, grounded STRICTLY in the real facts you are given below — never a generic,
memorized list of "policies every company needs."

Categorize every recommendation:
- "general": commonly needed regardless of sector, but only when the establishment's own facts
  (narrative, risks) actually indicate a real gap — e.g. no access-control policy exists and the
  narrative describes shared passwords or no MFA. Do not recommend a "general" policy just because
  it is common; ground it in something specific you were told.
- "sector": needed because of the establishment's specific sector/line of work, evidenced by the
  establishment narrative.
- "establishment": needed because of something specific about THIS establishment (a stated risk,
  a specific fact in its narrative — e.g. it holds client funds, serves government clients, handles
  minors' data) that would not apply to every organization in its sector.

For EVERY recommendation:
- "reason": why THIS establishment needs it, citing the specific fact that triggered it.
- "basis": the specific input this came from — name the risk, the plan item, or the [Rn]
  regulatory excerpt. Never leave this generic.
- "isRegulatoryRequirement": true ONLY if one of the provided [Rn] regulatory excerpts actually
  states this obligation, AND you cite that excerpt's marker in "references". If no regulatory
  excerpt supports it, this MUST be false, even if you believe it is common practice or you recall
  it from general knowledge — general knowledge is not a citation. A false value does not mean the
  policy is unimportant; it means it is a recommended practice, not a cited legal requirement.
- "practicalGuidance": concrete, actionable guidance — but if it includes specific parameters
  (e.g. a minimum password length, a retention period), you must not state them as if mandated
  unless a regulatory excerpt gives that exact figure; otherwise phrase them as a reasonable
  default a security/compliance practice would suggest.
- "references": regulatory excerpt markers ([R1], [R2], ...) when isRegulatoryRequirement is true;
  well-known standard/framework names (e.g. "ISO 27001 A.9", "NIST CSF PR.AC") are allowed here as
  best-practice benchmarks even when isRegulatoryRequirement is false — but never invent a specific
  clause number you were not given.

Do NOT recommend a policy whose purpose is already covered by an existing policy (see the list
below) unless the establishment's facts show a real, specific gap in it — state that gap in
"reason" if so.

Never invent a fact about the establishment, a risk, or a regulatory source. If you are not given
enough information to justify a particular recommendation, do not include it — under-recommending
is always safer than fabricating grounding.

Return between 5 and 15 recommendations, prioritizing critical/high-priority gaps first. Respond
with ONLY a single JSON object of exactly this shape (no prose before or after):
${RESPONSE_SHAPE}`;

export function buildPolicyRecommendationsPrompt(
  ctx: PolicyRecommendationsPromptContext,
): ChatMessage[] {
  const languageLine =
    ctx.locale === "ar"
      ? "Write every string value (title, reason, basis, practicalGuidance, recommendedContents, " +
        "relatedRequirementOrRisk) in professional Modern Standard Arabic. Keep framework/standard " +
        "names (e.g. ISO 27001, NIST CSF) in their original English form."
      : "Write every string value in professional business English.";

  const userMessage = `${languageLine}

## Establishment narrative (from its Governance Program assessment)
${ctx.establishmentNarrative || "(none available)"}

## Top risks/gaps on the governance plan
${ctx.topRisksText || "(none)"}

## Risk register
${ctx.registerRisksText || "(no risks recorded)"}

## Existing policies (do not duplicate; note gaps instead)
${ctx.existingPoliciesText || "(no policies exist yet)"}

## Regulatory sources found (cite by marker when used; state type and approval status if you cite one)
${ctx.regulatoryContextText || "(no matching regulatory source was found)"}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
}
