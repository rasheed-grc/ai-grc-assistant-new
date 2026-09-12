/**
 * Governance Plan Execution domain types (ADR 0066 §5, Phase 4) — the shapes
 * `lib/planExecution/service.ts` returns to route handlers and, from there, to the Plan
 * Execution page. Mirrors `lib/discovery/types.ts`'s jargon-free discipline: the UI never renders
 * raw engine vocabulary. `PlanItem.sourceSignalKeys` is the one deliberate exception — it crosses
 * the boundary as an opaque id list purely so the UI can resolve each one through its own
 * `discovery.question.<key>` label catalog (traceability: "which Discovery question produced this
 * item"). A key with no known label is dropped silently, never rendered raw.
 */

export type PlanItemStatus = "not_started" | "in_progress" | "done" | "deferred" | "not_applicable";
export type PlanStatus = "active" | "superseded";
export type TimeframeBucket = "week_1" | "week_2" | "month_1" | "month_3" | "month_6" | "year_1";
export type Priority = "critical" | "high" | "medium" | "low";
export type EffortSize = "small" | "medium" | "large";

/** The five report-facing maturity dimensions (ADR 0066 §4) — shared by the live Plan's Maturity
 * Journey and the pre-approval Report's Current Maturity / Governance Vision sections, so all
 * three render dimensions in the same fixed order. */
export const MATURITY_DIMENSION_ORDER = [
  "governance",
  "risk",
  "compliance",
  "cyber",
  "leadership",
] as const;

export interface MaturityRating {
  score: number;
  stars: number;
  label: string;
}

export interface PlanItem {
  id: string;
  planId: string;
  pillar: string;
  title: string;
  /** The i18n key behind `title`, when the plan was drafted with one. Empty for a plan drafted
   *  before the key was kept — `title` stays authoritative and is the fallback. */
  titleKey: string;
  objective: string;
  objectiveKey: string;
  expectedOutcome: string;
  rationale: string;
  timeframeBucket: TimeframeBucket;
  priority: Priority;
  effortSize: EffortSize;
  status: PlanItemStatus;
  dependsOnItemIds: string[];
  dueAt: number | null;
  completedAt: number | null;
  evidenceIds: string[];
  isEvidenceBacked: boolean;
  confidence: number | null;
  riskIfSkipped: string | null;
  /** Opaque Discovery-signal ids this item traces back to. Resolve through
   *  `discovery.question.<key>` before rendering; drop any key without a label. */
  sourceSignalKeys: string[];
  createdAt: number;
  updatedAt: number;
}

export interface InferredFramework {
  frameworkId: string;
  confidence: number;
  rationaleKey: string;
}

export interface TopRisk {
  gapId?: string;
  severity?: string;
  description?: string;
  impact?: string;
  [key: string]: unknown;
}

export interface GovernancePlan {
  id: string;
  version: number;
  status: PlanStatus;
  previousPlanId: string | null;
  sourceSessionId: string | null;
  sourceMissionId: string;
  inferredFrameworks: InferredFramework[];
  maturityBaseline: Record<string, MaturityRating>;
  maturityAtSupersession: Record<string, MaturityRating> | null;
  executiveSummary: string | null;
  topRisks: TopRisk[];
  createdAt: number;
  updatedAt: number;
}

export interface PlanDetail {
  plan: GovernancePlan;
  items: PlanItem[];
}

export interface CurrentMaturity {
  hasBaseline: boolean;
  maturity: Record<string, MaturityRating> | null;
}

export interface PlanEvent {
  id: string;
  sequence: number;
  eventType: "started" | "completed" | "reopened" | "evidence_attached" | string;
  actorId: string;
  createdAt: number;
}
