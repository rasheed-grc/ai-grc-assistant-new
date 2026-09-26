/**
 * Missions — proxied to grc-api's `/v1/missions` (ADR 0052: the single product API surface).
 *
 * **This is the whole of the "two Missions" fix.** The workspace used to read `policy_missions`, a
 * table written only by the previous-generation `apps/api` and disconnected from the Mission Engine
 * that actually runs the product's missions (ADR 0066 said so in its Context; nothing had repointed
 * the page). A customer could approve a governance mission end to end and still be told
 * "No missions yet".
 *
 * No data was copied and nothing is synchronised: the engine is asked, at read time, what missions
 * this tenant has. The legacy table is untouched — its rows, if a previous-generation deployment
 * ever wrote any, are still exactly where they were.
 *
 * Create/run/result follow the same proxy shape, added so a user can start a Gap/Risk Assessment
 * from the workspace instead of needing to know this API exists at all (Mission-Centric UX,
 * CLAUDE.md §18). Every call carries the actor's own `tenantId` into the signed service assertion
 * (`serviceToken.ts`) — grc-api's `require_tenant` derives the tenant from THAT signed token, never
 * from anything the browser could put in a request body, so a mission can never be read, created,
 * run, or resulted against another organization's tenant (CLAUDE.md §20).
 */

import { randomUUID } from "node:crypto";
import { ConflictError, ForbiddenError, NotFoundError, UpstreamError, ValidationError } from "@/lib/errors";
import type { ActorContext } from "@/lib/auth/actor";
import { logger } from "@/lib/observability/logger";
import { mintGrcApiServiceToken } from "@/lib/discovery/serviceToken";
import type {
  Coverage,
  CreatedMission,
  Mission,
  MissionDetail,
  MissionFinding,
  MissionPlanStep,
  MissionResult,
  ResultSection,
  StartableMissionType,
} from "./types";

const AWAITING_APPROVAL = "awaiting_approval";

function grcApiBaseUrl(): string {
  return process.env.GRC_API_BASE_URL ?? "http://localhost:8000";
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/** The shared proxy call every function below goes through — one place that mints the token, maps
 * transport failures, and maps grc-api's error envelope to this app's typed errors. Mirrors
 * `lib/discovery/service.ts`'s `callDiscoveryApi`, the established pattern for this backend. */
async function callMissionsApi<T>(
  actor: ActorContext,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const url = new URL(`/v1/missions${path}`, grcApiBaseUrl());
  const token = mintGrcApiServiceToken({ tenantId: actor.tenantId, principalId: actor.userId });

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
    logger.error("missions_upstream_unreachable", error, { url: url.toString() });
    throw new UpstreamError("Could not reach the missions backend.", true);
  }

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    const message = problem.error?.message ?? `Request failed (${response.status}).`;
    if (response.status === 403) throw new ForbiddenError(message);
    if (response.status === 404) throw new NotFoundError(message);
    if (response.status === 400) throw new ValidationError(message);
    if (response.status === 409) throw new ConflictError(message);
    logger.error("missions_upstream_error", {
      status: response.status,
      code: problem.error?.code,
      url: url.toString(),
    });
    throw new UpstreamError(message);
  }

  return (await response.json()) as T;
}

// --- DTOs (grc-api's snake_case wire shape) -> domain types (camelCase) ------------------------

interface MissionRowDto {
  id: string;
  type: string;
  scope: string;
  status: string;
  created_at: number;
  updated_at: number;
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

interface MissionDetailDto {
  id: string;
  type: string;
  scope: string;
  status: string;
  plan: PlanStepDto[];
  findings: FindingDto[];
  created_at: number;
  updated_at: number;
}

interface CreatedMissionDto {
  mission: MissionDetailDto;
  steps: number;
  human_approvals: number;
}

interface StartMissionResponseDto {
  mission_id: string;
  status: string;
  approval_pending: boolean;
}

interface ResultDto {
  mission_id: string;
  title: string;
  trust: { evidence_count: number; human_review: string; updated_at: number };
  content: {
    sections: { heading: string; body: string; citations: string[]; confidence: number | null }[];
    kind: string;
    coverage?: {
      framework: string;
      coverage: number;
      covered_count: number;
      total: number;
      gaps: { control_code: string; control_title: string; covered: boolean; evidence: string[] }[];
    };
  };
}

/** grc-api reports timestamps as epoch seconds; the workspace renders ISO strings. */
function toIso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function toMission(dto: MissionRowDto): Mission {
  return {
    id: dto.id,
    type: dto.type,
    scope: dto.scope,
    status: dto.status,
    awaitingApproval: dto.status === AWAITING_APPROVAL,
    createdAt: toIso(dto.created_at),
    updatedAt: toIso(dto.updated_at),
  };
}

function toFinding(dto: FindingDto): MissionFinding {
  return {
    stepId: dto.step_id,
    title: dto.title,
    summary: dto.summary,
    citations: dto.citations,
    confidence: dto.confidence,
  };
}

function toPlanStep(dto: PlanStepDto): MissionPlanStep {
  return { id: dto.id, description: dto.description };
}

function toMissionDetail(dto: MissionDetailDto): MissionDetail {
  return {
    id: dto.id,
    type: dto.type,
    scope: dto.scope,
    status: dto.status as MissionDetail["status"],
    plan: dto.plan.map(toPlanStep),
    findings: dto.findings.map(toFinding),
    awaitingApproval: dto.status === AWAITING_APPROVAL,
    createdAt: toIso(dto.created_at),
    updatedAt: toIso(dto.updated_at),
  };
}

function toResultSection(dto: ResultDto["content"]["sections"][number]): ResultSection {
  return { heading: dto.heading, body: dto.body, citations: dto.citations, confidence: dto.confidence };
}

function toCoverage(dto: NonNullable<ResultDto["content"]["coverage"]>): Coverage {
  return {
    framework: dto.framework,
    coverage: dto.coverage,
    coveredCount: dto.covered_count,
    total: dto.total,
    gaps: dto.gaps.map((g) => ({
      controlCode: g.control_code,
      controlTitle: g.control_title,
      covered: g.covered,
      evidence: g.evidence,
    })),
  };
}

function toMissionResult(dto: ResultDto): MissionResult {
  return {
    missionId: dto.mission_id,
    title: dto.title,
    evidenceCount: dto.trust.evidence_count,
    humanReview: dto.trust.human_review,
    updatedAt: toIso(dto.trust.updated_at),
    sections: dto.content.sections.map(toResultSection),
    coverage: dto.content.coverage ? toCoverage(dto.content.coverage) : null,
  };
}

/** Every mission the engine holds for the actor's tenant, newest first (CLAUDE.md §20 — the tenant
 * is asserted in the token, so the scope is the backend's to enforce, not this caller's to filter). */
export async function listMissions(actor: ActorContext): Promise<Mission[]> {
  const payload = await callMissionsApi<{ items: MissionRowDto[] }>(actor, "GET", "?page_size=100");
  return payload.items.map(toMission);
}

/** One mission's full detail — plan (what will/did run) + findings (what has, so far). Used for
 * both the review station (nothing has run yet: `findings` is empty) and progress polling. */
export async function getMission(actor: ActorContext, missionId: string): Promise<MissionDetail> {
  const dto = await callMissionsApi<MissionDetailDto>(actor, "GET", `/${missionId}`);
  return toMissionDetail(dto);
}

/** Creates a new mission of `type`, scoped to `scope` — the review station: plans it (real steps,
 * from the real Mission Catalog) but does not run it. `type` is restricted to
 * `StartableMissionType` at the type level; grc-api independently re-validates against its own
 * catalog regardless (never trust the caller's claim of what is valid). */
export async function createMission(
  actor: ActorContext,
  type: StartableMissionType,
  scope: string,
): Promise<CreatedMission> {
  const dto = await callMissionsApi<CreatedMissionDto>(actor, "POST", "", {
    body: { type, scope, document_ids: [] },
    idempotencyKey: randomUUID(),
  });
  return { mission: toMissionDetail(dto.mission), steps: dto.steps, humanApprovals: dto.human_approvals };
}

/** Starts a created mission running. A second call on the same mission is a 409 (already
 * started) — surfaced as `ConflictError` so the UI can tell "someone already clicked Execute"
 * from every other failure. */
export async function runMission(
  actor: ActorContext,
  missionId: string,
): Promise<{ status: string; awaitingApproval: boolean }> {
  const dto = await callMissionsApi<StartMissionResponseDto>(actor, "POST", `/${missionId}/run`);
  return { status: dto.status, awaitingApproval: dto.approval_pending };
}

/** The polished Result (the engine's "Deliverable") once a mission has completed. Not-yet-ready
 * (still running, or never started) is a 409 from grc-api, surfaced as `ConflictError` — the UI
 * reads that as "keep polling `getMission` instead", never as a hard failure. */
export async function getMissionResult(actor: ActorContext, missionId: string): Promise<MissionResult> {
  const dto = await callMissionsApi<ResultDto>(actor, "GET", `/${missionId}/deliverable`);
  return toMissionResult(dto);
}
