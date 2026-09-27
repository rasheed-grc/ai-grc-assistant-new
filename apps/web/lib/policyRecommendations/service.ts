/**
 * Policy Recommendations application service — the "Analyze Policy Needs" workflow (CLAUDE.md §3
 * pillar 10: Governance Program → Policy Requirements → Policy Recommendations → Draft → Review →
 * Approval → Published Policy → Tasks/Controls). Every recommendation is grounded in the tenant's
 * OWN real data, gathered through the exact services the rest of the product already uses — no
 * separate/duplicated data path, no hardcoded per-sector list. Tenant-scoped throughout. Node-only.
 */

import { randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, UpstreamError, ValidationError } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { enforceRegulatoryGrounding } from "./grounding";
import type { ActorContext } from "@/lib/auth/actor";
import { getChatProvider } from "@/lib/ai";
import { getActivePlan } from "@/lib/planExecution/service";
import type { PlanItem, TopRisk } from "@/lib/planExecution/types";
import { listRisks } from "@/lib/risk/service";
import type { Risk } from "@/lib/risk/types";
import { policyRepository } from "@/lib/policies/repository";
import type { Policy } from "@/lib/policies/types";
import {
  searchRegulatorySources,
  DOCUMENT_TYPE_LABEL_AR,
  DOCUMENT_TYPE_LABEL_EN,
  STATUS_LABEL_AR,
  STATUS_LABEL_EN,
  type RegulatorySourceHit,
} from "@/lib/regulatoryReasoning/search";
import type { AppLocale } from "@/i18n/routing";
import { policyRecommendationRepository } from "./repository";
import {
  buildPolicyRecommendationsPrompt,
  POLICY_RECOMMENDATIONS_PROMPT_VERSION,
} from "./prompts";
import {
  llmRecommendationsResponseSchema,
  type LlmRecommendation,
  type PolicyRecommendation,
} from "./types";

const MAX_OPEN_ITEMS_IN_NARRATIVE = 10;
const MAX_REGULATORY_QUERIES = 4;
const MAX_REGULATORY_HITS = 8;

function assertCanManage(actor: ActorContext): void {
  if (!can(actor.roles, "create", "policy")) {
    throw new ForbiddenError("You are not permitted to manage policy recommendations.");
  }
}

function assertCanRead(actor: ActorContext): void {
  if (!can(actor.roles, "read", "policy")) {
    throw new ForbiddenError("You are not permitted to view policy recommendations.");
  }
}

function buildEstablishmentNarrative(
  executiveSummary: string | null,
  items: PlanItem[],
): string {
  const openItems = items
    .filter((i) => i.status === "not_started" || i.status === "in_progress")
    .slice(0, MAX_OPEN_ITEMS_IN_NARRATIVE);
  const itemLines = openItems.map(
    (i) => `- [${i.pillar}/${i.priority}] ${i.title}: ${i.rationale}`,
  );
  const parts = [executiveSummary?.trim(), ...itemLines].filter(Boolean);
  return parts.join("\n");
}

function buildTopRisksText(topRisks: TopRisk[]): string {
  if (topRisks.length === 0) return "";
  return topRisks
    .map((r) => `- ${r.description ?? r.gapId ?? "risk"} (severity: ${r.severity ?? "unknown"})`)
    .join("\n");
}

function buildRegisterRisksText(risks: Risk[]): string {
  if (risks.length === 0) return "";
  return risks
    .map(
      (r) =>
        `- "${r.title}" (${r.category}, status: ${r.status}, likelihood ${r.likelihood}/5, ` +
        `impact ${r.impact}/5)${r.description ? `: ${r.description}` : ""}`,
    )
    .join("\n");
}

function buildExistingPoliciesText(policies: Policy[]): string {
  if (policies.length === 0) return "";
  return policies.map((p) => `- "${p.title}" (status: ${p.status})`).join("\n");
}

function formatRegulatoryContext(hits: RegulatorySourceHit[], locale: AppLocale): string {
  if (hits.length === 0) return "";
  const typeLabels = locale === "ar" ? DOCUMENT_TYPE_LABEL_AR : DOCUMENT_TYPE_LABEL_EN;
  const statusLabels = locale === "ar" ? STATUS_LABEL_AR : STATUS_LABEL_EN;
  return hits
    .map((hit, i) => {
      const heading =
        `[R${i + 1}] "${hit.sourceTitleAr}" (${typeLabels[hit.documentType]}) — ` +
        `${locale === "ar" ? "حالة الاعتماد" : "approval status"}: ${statusLabels[hit.status]}`;
      return `${heading}\n${hit.textAr}`;
    })
    .join("\n\n");
}

/** Cheap, real keyword search across a few establishment-derived topics — not a semantic search,
 *  but every hit is a real regulatory excerpt (never fabricated). Deduplicated by section id. */
async function gatherRegulatoryContext(
  topics: string[],
  locale: AppLocale,
): Promise<{ hits: RegulatorySourceHit[]; text: string }> {
  const seen = new Map<string, RegulatorySourceHit>();
  for (const topic of topics.slice(0, MAX_REGULATORY_QUERIES)) {
    const hits = await searchRegulatorySources(topic, 4);
    for (const hit of hits) {
      if (!seen.has(hit.sectionId)) seen.set(hit.sectionId, hit);
    }
    if (seen.size >= MAX_REGULATORY_HITS) break;
  }
  const hits = [...seen.values()].slice(0, MAX_REGULATORY_HITS);
  return { hits, text: formatRegulatoryContext(hits, locale) };
}

// Matches `lib/analysis/service.ts`'s proven budget for this same reasoning model
// (OPENAI_MODEL=gpt-5): a reasoning model spends `max_completion_tokens` on its internal
// reasoning FIRST, and only emits visible output from whatever budget remains — 6000 was
// entirely consumed by reasoning on a live run, leaving zero tokens for the actual JSON and
// producing an empty completion (not an error, just `content: ""`). 20000 leaves real headroom
// for both the reasoning and up to 15 fully-detailed recommendations.
const RECOMMENDATION_MAX_TOKENS = 20_000;

async function callModelForRecommendations(
  messages: ReturnType<typeof buildPolicyRecommendationsPrompt>,
): Promise<LlmRecommendation[]> {
  const chat = getChatProvider();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await chat.complete(
      attempt === 0
        ? messages
        : [
            ...messages,
            {
              role: "user" as const,
              content:
                "Your previous response was not valid JSON matching the required shape. " +
                "Respond with ONLY the JSON object, no other text.",
            },
          ],
      { json: true, maxTokens: RECOMMENDATION_MAX_TOKENS },
    );
    try {
      const parsed = JSON.parse(raw);
      const result = llmRecommendationsResponseSchema.safeParse(parsed);
      if (result.success) return result.data.recommendations;
    } catch {
      // fall through to retry
    }
  }
  throw new UpstreamError("The AI service returned an invalid response. Please try again.");
}

export async function generateRecommendations(
  actor: ActorContext,
  locale: AppLocale,
): Promise<PolicyRecommendation[]> {
  assertCanManage(actor);

  const plan = await getActivePlan(actor);
  if (!plan) {
    throw new ValidationError(
      "Complete the Governance Program before generating policy recommendations.",
    );
  }

  const [risks, existingPolicies] = await Promise.all([
    listRisks(actor),
    policyRepository.list(actor.tenantId),
  ]);

  const establishmentNarrative = buildEstablishmentNarrative(plan.plan.executiveSummary, plan.items);
  const topRisksText = buildTopRisksText(plan.plan.topRisks);
  const registerRisksText = buildRegisterRisksText(risks);
  const existingPoliciesText = buildExistingPoliciesText(existingPolicies);

  // Real, tenant-derived search topics — never a static list. Drawn from what the establishment's
  // own governance narrative and risk register actually say.
  const topics = [
    ...plan.items.slice(0, 6).map((i) => i.title),
    ...risks.slice(0, 4).map((r) => r.title),
  ].filter(Boolean);
  const { hits: regulatoryHits, text: regulatoryContextText } = await gatherRegulatoryContext(
    topics,
    locale,
  );

  const messages = buildPolicyRecommendationsPrompt({
    establishmentNarrative,
    topRisksText,
    registerRisksText,
    existingPoliciesText,
    regulatoryContextText,
    locale,
  });

  // The model proposes; this decides which recommendations may claim to be legal requirements.
  const recommendations = enforceRegulatoryGrounding(
    await callModelForRecommendations(messages),
    regulatoryHits,
  );
  return policyRecommendationRepository.replacePending(
    actor.tenantId,
    plan.plan.sourceSessionId ?? undefined,
    recommendations,
  );
}

export async function listRecommendations(actor: ActorContext): Promise<PolicyRecommendation[]> {
  assertCanRead(actor);
  return policyRecommendationRepository.list(actor.tenantId);
}

function policyBodyFromRecommendation(rec: PolicyRecommendation): string {
  const contents = rec.recommendedContents.map((c) => `- ${c}`).join("\n");
  const refs = rec.references.length > 0 ? `\n\nReferences: ${rec.references.join(", ")}` : "";
  return `${rec.practicalGuidance}\n\n${contents}${refs}`;
}

export async function draftFromRecommendation(
  actor: ActorContext,
  id: string,
): Promise<{ recommendation: PolicyRecommendation; policy: Policy }> {
  assertCanManage(actor);
  const recommendation = await policyRecommendationRepository.get(actor.tenantId, id);
  if (!recommendation) throw new NotFoundError("Recommendation not found.");
  if (recommendation.status !== "pending") {
    throw new ValidationError("This recommendation was already actioned.");
  }

  const now = new Date().toISOString();
  const policy: Policy = {
    id: randomUUID(),
    tenantId: actor.tenantId,
    title: recommendation.title,
    summary: recommendation.reason,
    body: policyBodyFromRecommendation(recommendation),
    status: "draft",
    ownerName: actor.userName,
    controlIds: [],
    createdByUserId: actor.userId,
    createdByName: actor.userName,
    createdAt: now,
    updatedAt: now,
    aiGenerated: true,
    generatedByTool: "policy-recommendations",
    generationMetadata: {
      promptVersion: POLICY_RECOMMENDATIONS_PROMPT_VERSION,
      citations: recommendation.references,
      recommendationId: recommendation.id,
    },
  };
  const created = await policyRepository.create(policy);
  const updated = await policyRecommendationRepository.markDrafted(actor.tenantId, id, created.id);
  if (!updated) throw new NotFoundError("Recommendation not found.");
  return { recommendation: updated, policy: created };
}

export async function dismissRecommendation(
  actor: ActorContext,
  id: string,
): Promise<PolicyRecommendation> {
  assertCanManage(actor);
  const updated = await policyRecommendationRepository.markDismissed(actor.tenantId, id);
  if (!updated) throw new NotFoundError("Recommendation not found or already actioned.");
  return updated;
}
