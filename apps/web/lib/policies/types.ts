/**
 * Policy domain types. A policy is an authored governance document that maps to controls and
 * moves through an approval workflow before publication (human gate — CLAUDE.md §1).
 */

export const POLICY_STATUSES = ["draft", "in_review", "published", "archived"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export interface PolicyGenerationMetadata {
  model?: string;
  promptVersion?: string;
  confidence?: number;
  citations?: string[];
  sourceDocumentIds?: string[];
  invocationId?: string;
  /** The `policy_recommendations.id` this draft was created from, when applicable. */
  recommendationId?: string;
}

export interface Policy {
  id: string;
  tenantId: string;
  title: string;
  summary?: string;
  body?: string;
  status: PolicyStatus;
  ownerName: string;
  controlIds: string[];
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  approvedByName?: string;
  approvedAt?: string;
  /** Provenance (0014_policy_provenance.sql) — set when a draft was authored by an AI tool
   *  (e.g. Policies Intelligence) rather than typed by hand, so the workspace can disclose it. */
  aiGenerated?: boolean;
  generatedByTool?: string;
  generationMetadata?: PolicyGenerationMetadata;
}

export interface PolicySummary {
  id: string;
  title: string;
  summary?: string;
  status: PolicyStatus;
  ownerName: string;
  controlCount: number;
  updatedAt: string;
}

export function toPolicySummary(policy: Policy): PolicySummary {
  return {
    id: policy.id,
    title: policy.title,
    summary: policy.summary,
    status: policy.status,
    ownerName: policy.ownerName,
    controlCount: policy.controlIds.length,
    updatedAt: policy.updatedAt,
  };
}

/** Allowed status transitions (the workflow graph). */
export const POLICY_TRANSITIONS: Record<PolicyStatus, PolicyStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["published", "draft", "archived"],
  published: ["archived", "draft"],
  archived: ["draft"],
};

export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean {
  return POLICY_TRANSITIONS[from].includes(to);
}
