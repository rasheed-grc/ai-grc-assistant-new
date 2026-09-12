/**
 * Policy Recommendations (Policies Intelligence, V2) domain types. A recommendation is what
 * "Analyze Policy Needs" produces: a context-aware suggestion — never a hardcoded per-sector list
 * — grounded in the organization's actual Governance Program answers, its risks, its existing
 * policies, and (when a match exists) real regulatory sources (`lib/regulatoryReasoning/search`).
 */

import { z } from "zod";

export const POLICY_RECOMMENDATION_CATEGORIES = ["general", "sector", "establishment"] as const;
export type PolicyRecommendationCategory = (typeof POLICY_RECOMMENDATION_CATEGORIES)[number];

export const POLICY_RECOMMENDATION_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type PolicyRecommendationPriority = (typeof POLICY_RECOMMENDATION_PRIORITIES)[number];

export const POLICY_RECOMMENDATION_STATUSES = ["pending", "drafted", "dismissed"] as const;
export type PolicyRecommendationStatus = (typeof POLICY_RECOMMENDATION_STATUSES)[number];

export interface PolicyRecommendation {
  id: string;
  tenantId: string;
  category: PolicyRecommendationCategory;
  title: string;
  reason: string;
  priority: PolicyRecommendationPriority;
  isRegulatoryRequirement: boolean;
  basis: string;
  relatedRequirementOrRisk?: string;
  practicalGuidance: string;
  recommendedContents: string[];
  references: string[];
  status: PolicyRecommendationStatus;
  createdPolicyId?: string;
  sourceAssessmentId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The LLM's raw output contract — one array of recommendation drafts, validated before anything
 * touches the database (CLAUDE.md §6 pillar 8: never trust raw LLM text as control flow). A
 * recommendation that fails this schema is dropped, not coerced — better to under-recommend than
 * to persist a malformed one.
 */
export const llmRecommendationSchema = z.object({
  category: z.enum(POLICY_RECOMMENDATION_CATEGORIES),
  title: z.string().min(3).max(200),
  reason: z.string().min(10),
  priority: z.enum(POLICY_RECOMMENDATION_PRIORITIES),
  isRegulatoryRequirement: z.boolean(),
  basis: z.string().min(5),
  relatedRequirementOrRisk: z.string().optional(),
  practicalGuidance: z.string().min(10),
  recommendedContents: z.array(z.string().min(1)).min(1).max(15),
  references: z.array(z.string()).max(10).default([]),
});

export const llmRecommendationsResponseSchema = z.object({
  recommendations: z.array(llmRecommendationSchema).max(30),
});

export type LlmRecommendation = z.infer<typeof llmRecommendationSchema>;
