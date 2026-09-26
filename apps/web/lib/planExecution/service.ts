/**
 * Governance Plan Execution application service — proxies to `v2/apps/grc-api`'s
 * `/v1/governance-plans/*` router (ADR 0066 §5, Phase 4). Byte-for-byte the same proxy shape as
 * `lib/discovery/service.ts` (same service-assertion auth, same DTO -> domain mapping
 * discipline) — this is the second, not the first, feature wired this way. Node-only (server
 * components / route handlers only).
 */

import { ConflictError, ForbiddenError, NotFoundError, UpstreamError, ValidationError } from "@/lib/errors";
import type { ActorContext } from "@/lib/auth/actor";
import { logger } from "@/lib/observability/logger";
import { mintGrcApiServiceToken } from "@/lib/discovery/serviceToken";
import type {
  CurrentMaturity,
  EffortSize,
  GovernancePlan,
  InferredFramework,
  MaturityRating,
  PlanDetail,
  PlanEvent,
  PlanItem,
  PlanItemStatus,
  PlanStatus,
  Priority,
  TimeframeBucket,
  TopRisk,
} from "./types";

function grcApiBaseUrl(): string {
  return process.env.GRC_API_BASE_URL ?? "http://localhost:8000";
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function callPlanApi<T>(
  actor: ActorContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: { onUnreachable?: "error" | "warn" } = {},
): Promise<T> {
  const url = new URL(`/v1/governance-plans${path}`, grcApiBaseUrl());
  const token = mintGrcApiServiceToken({ tenantId: actor.tenantId, principalId: actor.userId });

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    // "warn" is for read-only call sites that degrade gracefully when the backend is briefly
    // unreachable (see getActivePlan) — logged, but not reported to Sentry (logger.error is the
    // only level that reports; see logger.ts). Consequential/mutating calls keep the default
    // "error" so a live backend actually going unreachable still alerts.
    if (options.onUnreachable === "warn") {
      logger.warn("plan_execution_upstream_unreachable", {
        url: url.toString(),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } else {
      logger.error("plan_execution_upstream_unreachable", error, { url: url.toString() });
    }
    throw new UpstreamError("Could not reach the Governance Plan backend.", true);
  }

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    const message = problem.error?.message ?? `Request failed (${response.status}).`;
    if (response.status === 403) throw new ForbiddenError(message);
    if (response.status === 404) throw new NotFoundError(message);
    if (response.status === 409) throw new ConflictError(message);
    if (response.status === 400) throw new ValidationError(message);
    logger.error("plan_execution_upstream_error", {
      status: response.status,
      code: problem.error?.code,
      url: url.toString(),
    });
    throw new UpstreamError(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- DTOs (grc-api's snake_case wire shape) -> domain types (camelCase) ------------------------

interface MaturityRatingDto {
  score: number;
  stars: number;
  label: string;
}

interface PlanItemDto {
  id: string;
  plan_id: string;
  pillar: string;
  title: string;
  title_key?: string;
  objective_key?: string;
  objective: string;
  expected_outcome: string;
  rationale: string;
  timeframe_bucket: string;
  priority: string;
  effort_size: string;
  status: string;
  depends_on_item_ids: string[];
  due_at: number | null;
  completed_at: number | null;
  evidence_ids: string[];
  is_evidence_backed: boolean;
  confidence: number | null;
  risk_if_skipped: string | null;
  source_signal_keys?: string[];
  created_at: number;
  updated_at: number;
}

interface PlanDto {
  id: string;
  version: number;
  status: string;
  previous_plan_id: string | null;
  source_session_id: string | null;
  source_mission_id: string;
  inferred_frameworks: Array<{ framework_id: string; confidence: number; rationale_key: string }>;
  maturity_baseline: Record<string, MaturityRatingDto>;
  maturity_at_supersession: Record<string, MaturityRatingDto> | null;
  executive_summary: string | null;
  top_risks: TopRisk[];
  created_at: number;
  updated_at: number;
}

interface PlanDetailDto {
  plan: PlanDto;
  items: PlanItemDto[];
}

interface PlanVersionsDto {
  items: PlanDto[];
}

interface CurrentMaturityDto {
  has_baseline: boolean;
  maturity: Record<string, MaturityRatingDto> | null;
}

interface PlanEventDto {
  id: string;
  sequence: number;
  event_type: string;
  actor_id: string;
  created_at: number;
}

function toItem(dto: PlanItemDto): PlanItem {
  return {
    id: dto.id,
    planId: dto.plan_id,
    pillar: dto.pillar,
    title: dto.title,
    // Optional on the wire and defaulted here rather than at every reader: a plan drafted before
    // the key was kept sends none, and every consumer would otherwise need its own guard.
    titleKey: dto.title_key ?? "",
    objectiveKey: dto.objective_key ?? "",
    objective: dto.objective,
    expectedOutcome: dto.expected_outcome,
    rationale: dto.rationale,
    timeframeBucket: dto.timeframe_bucket as TimeframeBucket,
    priority: dto.priority as Priority,
    effortSize: dto.effort_size as EffortSize,
    status: dto.status as PlanItemStatus,
    dependsOnItemIds: dto.depends_on_item_ids,
    dueAt: dto.due_at,
    completedAt: dto.completed_at,
    evidenceIds: dto.evidence_ids,
    isEvidenceBacked: dto.is_evidence_backed,
    confidence: dto.confidence,
    riskIfSkipped: dto.risk_if_skipped,
    sourceSignalKeys: dto.source_signal_keys ?? [],
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

function toFrameworks(
  dtos: Array<{ framework_id: string; confidence: number; rationale_key: string }>,
): InferredFramework[] {
  return dtos.map((f) => ({
    frameworkId: f.framework_id,
    confidence: f.confidence,
    rationaleKey: f.rationale_key,
  }));
}

function toPlan(dto: PlanDto): GovernancePlan {
  return {
    id: dto.id,
    version: dto.version,
    status: dto.status as PlanStatus,
    previousPlanId: dto.previous_plan_id,
    sourceSessionId: dto.source_session_id,
    sourceMissionId: dto.source_mission_id,
    inferredFrameworks: toFrameworks(dto.inferred_frameworks),
    maturityBaseline: dto.maturity_baseline,
    maturityAtSupersession: dto.maturity_at_supersession,
    executiveSummary: dto.executive_summary,
    topRisks: dto.top_risks,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

function toEvent(dto: PlanEventDto): PlanEvent {
  return {
    id: dto.id,
    sequence: dto.sequence,
    eventType: dto.event_type as PlanEvent["eventType"],
    actorId: dto.actor_id,
    createdAt: dto.created_at,
  };
}

// --- public API ---------------------------------------------------------------------------

export async function getActivePlan(actor: ActorContext): Promise<PlanDetail | null> {
  let dto: PlanDetailDto | null;
  try {
    dto = await callPlanApi<PlanDetailDto | null>(actor, "GET", "/active", undefined, {
      onUnreachable: "warn",
    });
  } catch (error) {
    // The backend being briefly unreachable (restart, deploy, network blip) is a known,
    // expected condition for this read — degrade to "no active plan" (a state this function
    // already returns normally) instead of crashing every page that checks for one (e.g.
    // /discovery's routing check). A genuinely misbehaving (but reachable) backend still
    // throws below, since that's worth alerting on.
    if (error instanceof UpstreamError && error.unreachable) return null;
    throw error;
  }
  if (!dto) return null;
  return { plan: toPlan(dto.plan), items: dto.items.map(toItem) };
}

export async function getPlan(actor: ActorContext, planId: string): Promise<PlanDetail> {
  const dto = await callPlanApi<PlanDetailDto>(actor, "GET", `/${encodeURIComponent(planId)}`);
  return { plan: toPlan(dto.plan), items: dto.items.map(toItem) };
}

export async function getPlanVersions(actor: ActorContext): Promise<GovernancePlan[]> {
  const dto = await callPlanApi<PlanVersionsDto>(actor, "GET", "/versions");
  return dto.items.map(toPlan);
}

export async function getCurrentMaturity(actor: ActorContext): Promise<CurrentMaturity> {
  const dto = await callPlanApi<CurrentMaturityDto>(actor, "GET", "/maturity");
  return { hasBaseline: dto.has_baseline, maturity: dto.maturity };
}

export async function getPlanItemEvents(actor: ActorContext, itemId: string): Promise<PlanEvent[]> {
  const dto = await callPlanApi<{ items: PlanEventDto[] }>(
    actor,
    "GET",
    `/items/${encodeURIComponent(itemId)}/events`,
  );
  return dto.items.map(toEvent);
}

export async function startPlanItem(actor: ActorContext, itemId: string): Promise<PlanItem> {
  const dto = await callPlanApi<PlanItemDto>(actor, "POST", `/items/${encodeURIComponent(itemId)}/start`);
  return toItem(dto);
}

export async function completePlanItem(actor: ActorContext, itemId: string): Promise<PlanItem> {
  const dto = await callPlanApi<PlanItemDto>(
    actor,
    "POST",
    `/items/${encodeURIComponent(itemId)}/complete`,
  );
  return toItem(dto);
}

export async function reopenPlanItem(actor: ActorContext, itemId: string): Promise<PlanItem> {
  const dto = await callPlanApi<PlanItemDto>(actor, "POST", `/items/${encodeURIComponent(itemId)}/reopen`);
  return toItem(dto);
}

export async function attachPlanItemEvidence(
  actor: ActorContext,
  itemId: string,
  evidenceIds: string[],
): Promise<PlanItem> {
  const dto = await callPlanApi<PlanItemDto>(
    actor,
    "POST",
    `/items/${encodeURIComponent(itemId)}/evidence`,
    { evidence_ids: evidenceIds },
  );
  return toItem(dto);
}

export type { MaturityRating };
