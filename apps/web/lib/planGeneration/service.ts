/**
 * The Mission bridge (ADR 0066 §3, Product Flow Simplification) — proxies to `v2/apps/grc-api`'s
 * generic `/v1/missions` + `/v1/approvals` routers to create, run, and read the
 * `generate_governance_plan` Mission, and to cross the ADR 0044 human-approval gate. Byte-for-byte
 * the same proxy shape as `lib/discovery/service.ts` (same service-assertion auth, same DTO ->
 * domain mapping discipline) — the third feature wired this way, not a new pattern.
 *
 * This module is what makes Discovery -> Report -> Plan one journey instead of two disconnected
 * pages: before this existed, nothing in `apps/web` ever created or ran this Mission at all.
 */

import { randomUUID } from "node:crypto";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "@/lib/errors";
import type { ActorContext } from "@/lib/auth/actor";
import { logger } from "@/lib/observability/logger";
import { mintGrcApiServiceToken } from "@/lib/discovery/serviceToken";
import type { GovernanceReportDraft, PlanGenerationResult } from "./types";

export { canApprovePlanGeneration } from "./permissions";

const MISSION_TYPE = "generate_governance_plan";
const DRAFT_STEP_DESCRIPTION = "Draft the governance plan for review";
const DRAFT_STEP_INDEX = 2; // resolve_applicability, gather_control_library, draft_plan, finalize_plan

function grcApiBaseUrl(): string {
  return process.env.GRC_API_BASE_URL ?? "http://localhost:8000";
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function callMissionApi<T>(
  actor: ActorContext,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotencyKey?: string; grantApprover?: boolean } = {},
): Promise<T> {
  const url = new URL(path, grcApiBaseUrl());
  const roles = options.grantApprover ? [...actor.roles, "approver"] : [...actor.roles];
  const token = mintGrcApiServiceToken({ tenantId: actor.tenantId, principalId: actor.userId, roles });

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    logger.error("plan_generation_upstream_unreachable", error, { url: url.toString() });
    throw new UpstreamError("Could not reach the Governance Plan backend.", true);
  }

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    const message = problem.error?.message ?? `Request failed (${response.status}).`;
    if (response.status === 403) throw new ForbiddenError(message);
    if (response.status === 404) throw new NotFoundError(message);
    if (response.status === 409) throw new ConflictError(message);
    if (response.status === 400) throw new ValidationError(message);
    logger.error("plan_generation_upstream_error", {
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

interface PlanStepDto {
  id: string;
  description: string;
}

interface FindingDto {
  step_id: string;
  title: string;
  summary: string;
  citations: string[];
  confidence: number | null;
}

interface ApprovalDto {
  id: string;
  proposed_action: string;
  status: string;
}

interface MissionDetailDto {
  id: string;
  type: string;
  scope: string;
  status: string;
  plan: PlanStepDto[];
  findings: FindingDto[];
  approval: ApprovalDto | null;
  created_at: number;
  updated_at: number;
}

interface MissionCreatedDto {
  mission: MissionDetailDto;
  steps: number;
  human_approvals: number;
}

interface MissionListDto {
  items: Array<{ id: string; type: string; scope: string; status: string }>;
}

interface DraftDto {
  source_session_id: string;
  inferred_frameworks: Array<{ framework_id: string; confidence: number; rationale_key: string }>;
  maturity_baseline: Record<string, MaturityRatingDto>;
  maturity_vision: Record<string, MaturityRatingDto>;
  executive_summary: string;
  top_risks: Array<{ gap_id: string; severity: string; description: string; impact: string }>;
  items: Array<{
    id: string;
    pillar: string;
    title: string;
    title_key?: string;
    objective: string;
    expected_outcome: string;
    rationale: string;
    risk_if_skipped: string;
    timeframe_bucket: string;
    priority: string;
    effort_size: string;
    confidence: number | null;
    due_at: number | null;
  }>;
}

/**
 * `draft_plan` is deterministically the 3rd completed step of this Mission's fixed 4-step shape
 * (`assistant_runtime/builtin/generate_governance_plan.py`) — guarded by matching the plan step's
 * own description rather than trusting the index blindly, so a future change to that Mission's
 * shape fails loudly here instead of silently parsing the wrong step's output as a report.
 */
function extractDraft(detail: MissionDetailDto): GovernanceReportDraft {
  const draftStep = detail.plan[DRAFT_STEP_INDEX];
  if (!draftStep || draftStep.description !== DRAFT_STEP_DESCRIPTION) {
    throw new UpstreamError("The governance plan Mission's shape has changed unexpectedly.");
  }
  const finding = detail.findings.find((f) => f.step_id === draftStep.id);
  if (!finding || !finding.summary) {
    throw new UpstreamError("The governance plan draft is not ready yet.");
  }
  let dto: DraftDto;
  try {
    dto = JSON.parse(finding.summary) as DraftDto;
  } catch {
    throw new UpstreamError("The governance plan draft was not valid JSON.");
  }
  return {
    sourceSessionId: dto.source_session_id,
    inferredFrameworks: dto.inferred_frameworks.map((f) => ({
      frameworkId: f.framework_id,
      confidence: f.confidence,
      rationaleKey: f.rationale_key,
    })),
    maturityBaseline: dto.maturity_baseline,
    maturityVision: dto.maturity_vision,
    executiveSummary: dto.executive_summary,
    topRisks: dto.top_risks.map((r) => ({
      gapId: r.gap_id,
      severity: r.severity,
      description: r.description,
      impact: r.impact,
    })),
    items: dto.items.map((i) => ({
      id: i.id,
      pillar: i.pillar,
      title: i.title,
      titleKey: i.title_key ?? "",
      objective: i.objective,
      expectedOutcome: i.expected_outcome,
      rationale: i.rationale,
      riskIfSkipped: i.risk_if_skipped,
      timeframeBucket: i.timeframe_bucket as GovernanceReportDraft["items"][number]["timeframeBucket"],
      priority: i.priority as GovernanceReportDraft["items"][number]["priority"],
      effortSize: i.effort_size as GovernanceReportDraft["items"][number]["effortSize"],
      confidence: i.confidence,
      dueAt: i.due_at,
    })),
  };
}

// --- public API ---------------------------------------------------------------------------

/** Creates and runs the Mission for a just-concluded Discovery session. The 3 non-consequential
 * steps run synchronously inside this call; the Mission pauses at `finalize_plan` (the one
 * consequential step) before returning — so this single call is the whole "analyzing" wait. */
export async function startPlanGeneration(
  actor: ActorContext,
  sessionId: string,
): Promise<PlanGenerationResult> {
  const created = await callMissionApi<MissionCreatedDto>(actor, "POST", "/v1/missions", {
    body: { type: MISSION_TYPE, scope: sessionId, document_ids: [] },
    idempotencyKey: randomUUID(),
  });
  const missionId = created.mission.id;
  await callMissionApi(actor, "POST", `/v1/missions/${encodeURIComponent(missionId)}/run`);
  const detail = await callMissionApi<MissionDetailDto>(
    actor,
    "GET",
    `/v1/missions/${encodeURIComponent(missionId)}`,
  );
  return { missionId, decisionId: detail.approval?.id ?? null, report: extractDraft(detail) };
}

/** Resumes a Mission the actor left mid-review (awaiting approval) without re-running Discovery. */
export async function getPendingPlanGeneration(
  actor: ActorContext,
): Promise<PlanGenerationResult | null> {
  const list = await callMissionApi<MissionListDto>(
    actor,
    "GET",
    `/v1/missions?type=${MISSION_TYPE}&status=awaiting_approval&page_size=1`,
  );
  const pending = list.items[0];
  if (!pending) return null;
  const detail = await callMissionApi<MissionDetailDto>(
    actor,
    "GET",
    `/v1/missions/${encodeURIComponent(pending.id)}`,
  );
  let report: GovernanceReportDraft;
  try {
    report = extractDraft(detail);
  } catch (error) {
    // A draft nobody can read cannot be reviewed, so it is not something to resume into. Failing
    // the whole check instead would strand the customer on every visit, behind a Mission they can
    // neither approve nor get past; a fresh generation replaces it.
    if (!(error instanceof UpstreamError)) throw error;
    logger.warn("plan_generation_pending_draft_unreadable", {
      missionId: pending.id,
      reason: error.message,
    });
    return null;
  }
  return { missionId: pending.id, decisionId: detail.approval?.id ?? null, report };
}

/** Crosses the ADR 0044 human-approval gate — the ONE consequential step, persisting the plan as
 * a new immutable snapshot (ADR 0066 §3.1). Requires an `"approver"`-mapped role; the caller
 * (the API route) must have already checked `canApprovePlanGeneration` — grc-api enforces the
 * same rule again server-side regardless, so this is defense in depth, not the only gate. */
export async function approvePlanGeneration(
  actor: ActorContext,
  missionId: string,
  decisionId: string,
): Promise<void> {
  await callMissionApi(
    actor,
    "POST",
    `/v1/missions/${encodeURIComponent(missionId)}/approvals/${encodeURIComponent(decisionId)}/approve`,
    { grantApprover: true },
  );
}
