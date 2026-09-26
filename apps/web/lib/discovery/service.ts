/**
 * Governance Discovery application service — proxies to `v2/apps/grc-api`'s `/v1/discovery/*`
 * router (ADR 0066), the first live wiring between `apps/web` and the V2 Python backend. Follows
 * the exact same shape as `lib/regulationReview/service.ts`'s proxy-to-FastAPI pattern, with one
 * difference: authentication is a freshly-minted service assertion (`serviceToken.ts`), not the
 * actor's `apiToken` (that token is scoped to the older `apps/api` service and its own, unrelated
 * credential scheme). Node-only (server components / route handlers only).
 */

import { ForbiddenError, NotFoundError, UpstreamError, ValidationError } from "@/lib/errors";
import type { ActorContext } from "@/lib/auth/actor";
import { logger } from "@/lib/observability/logger";
import { mintGrcApiServiceToken } from "./serviceToken";
import type {
  DiscoveryGoBackTarget,
  DiscoveryProgress,
  DiscoveryQuestion,
  DiscoverySessionStatus,
  DiscoveryTurn,
} from "./types";

function grcApiBaseUrl(): string {
  return process.env.GRC_API_BASE_URL ?? "http://localhost:8000";
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function callDiscoveryApi<T>(
  actor: ActorContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = new URL(`/v1/discovery${path}`, grcApiBaseUrl());
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
    logger.error("discovery_upstream_unreachable", error, { url: url.toString() });
    throw new UpstreamError("Could not reach the Governance Discovery backend.", true);
  }

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    const message = problem.error?.message ?? `Request failed (${response.status}).`;
    if (response.status === 403) throw new ForbiddenError(message);
    if (response.status === 404) throw new NotFoundError(message);
    if (response.status === 400) throw new ValidationError(message);
    logger.error("discovery_upstream_error", {
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

interface QuestionDto {
  id: string;
  prompt_key: string;
  value_type: string;
  options: string[] | null;
  ui_hint: string | null;
  allow_multiple: boolean;
  required: boolean;
  stage: string;
}

interface ProgressDto {
  stage: string;
  stage_index: number;
  stage_count: number;
}

interface TurnDto {
  session_id: string;
  status: string;
  question: QuestionDto | null;
  progress: ProgressDto | null;
}

interface GoBackDto {
  question: QuestionDto;
  previous_answer: unknown;
}

function toQuestion(dto: QuestionDto): DiscoveryQuestion {
  return {
    id: dto.id,
    promptKey: dto.prompt_key,
    valueType: dto.value_type as DiscoveryQuestion["valueType"],
    options: dto.options,
    uiHint: dto.ui_hint as DiscoveryQuestion["uiHint"],
    allowMultiple: dto.allow_multiple,
    required: dto.required,
    stage: dto.stage,
  };
}

function toProgress(dto: ProgressDto | null): DiscoveryProgress | null {
  if (!dto) return null;
  return { stage: dto.stage, stageIndex: dto.stage_index, stageCount: dto.stage_count };
}

function toTurn(dto: TurnDto): DiscoveryTurn {
  return {
    sessionId: dto.session_id,
    status: dto.status as DiscoverySessionStatus,
    question: dto.question ? toQuestion(dto.question) : null,
    progress: toProgress(dto.progress),
  };
}

// --- public API ---------------------------------------------------------------------------

export async function startDiscoverySession(actor: ActorContext): Promise<DiscoveryTurn> {
  const dto = await callDiscoveryApi<TurnDto>(actor, "POST", "/sessions");
  return toTurn(dto);
}

export async function getActiveDiscoverySession(actor: ActorContext): Promise<DiscoveryTurn | null> {
  const dto = await callDiscoveryApi<TurnDto | null>(actor, "GET", "/sessions/active");
  return dto ? toTurn(dto) : null;
}

export async function submitDiscoveryAnswer(
  actor: ActorContext,
  sessionId: string,
  questionId: string,
  value: unknown,
): Promise<DiscoveryTurn> {
  const dto = await callDiscoveryApi<TurnDto>(
    actor,
    "POST",
    `/sessions/${encodeURIComponent(sessionId)}/answers`,
    { question_id: questionId, value },
  );
  return toTurn(dto);
}

export async function skipDiscoveryQuestion(
  actor: ActorContext,
  sessionId: string,
  questionId: string,
): Promise<DiscoveryTurn> {
  const dto = await callDiscoveryApi<TurnDto>(
    actor,
    "POST",
    `/sessions/${encodeURIComponent(sessionId)}/skip`,
    { question_id: questionId },
  );
  return toTurn(dto);
}

export async function goBackDiscoveryAnswer(
  actor: ActorContext,
  sessionId: string,
): Promise<DiscoveryGoBackTarget> {
  const dto = await callDiscoveryApi<GoBackDto>(
    actor,
    "POST",
    `/sessions/${encodeURIComponent(sessionId)}/back`,
  );
  return { question: toQuestion(dto.question), previousAnswer: dto.previous_answer };
}
