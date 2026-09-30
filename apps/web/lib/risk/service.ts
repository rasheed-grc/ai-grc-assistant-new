/**
 * Risk application service. Maintains the risk register with 5×5 scoring, mitigating-control
 * linkage, ownership, and a status workflow. **Accepting a risk is human-gated** (requires
 * the `approve` permission — analysts can author but never accept). Tenant-scoped. Node-only.
 */

import { randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import type { ActorContext } from "@/lib/auth/actor";
import { isKnownControl } from "@/lib/frameworks/catalog";
import { riskRepository } from "./repository";
import {
  RISK_CATEGORIES,
  canTransitionRisk,
  type Risk,
  type RiskCategory,
  type RiskStatus,
} from "./types";

function clampScale(value: number | undefined, fallback: number): number {
  if (value == null || Number.isNaN(value)) return fallback;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function cleanControlIds(controlIds?: string[]): string[] {
  return Array.from(new Set((controlIds ?? []).filter(isKnownControl))).slice(0, 50);
}

function ensureCategory(category: string | undefined): RiskCategory {
  return (RISK_CATEGORIES as readonly string[]).includes(category ?? "")
    ? (category as RiskCategory)
    : "operational";
}

export async function listRisks(actor: ActorContext): Promise<Risk[]> {
  if (!can(actor.roles, "read", "risk"))
    throw new ForbiddenError("You are not permitted to view risks.");
  return riskRepository.list(actor.tenantId);
}

export async function getRisk(actor: ActorContext, id: string): Promise<Risk> {
  if (!can(actor.roles, "read", "risk"))
    throw new ForbiddenError("You are not permitted to view risks.");
  const risk = await riskRepository.get(actor.tenantId, id);
  if (!risk) throw new NotFoundError("Risk not found.");
  return risk;
}

export interface CreateRiskInput {
  title: string;
  description?: string;
  category?: string;
  likelihood?: number;
  impact?: number;
  ownerName?: string;
  controlIds?: string[];
  mitigationPlan?: string;
}

export async function createRisk(actor: ActorContext, input: CreateRiskInput): Promise<Risk> {
  if (!can(actor.roles, "create", "risk"))
    throw new ForbiddenError("You are not permitted to create risks.");
  const title = input.title.trim();
  if (!title) throw new ValidationError("A title is required.");

  const now = new Date().toISOString();
  const risk: Risk = {
    id: randomUUID(),
    tenantId: actor.tenantId,
    title,
    description: input.description?.trim() || undefined,
    category: ensureCategory(input.category),
    likelihood: clampScale(input.likelihood, 3),
    impact: clampScale(input.impact, 3),
    status: "open",
    ownerName: input.ownerName?.trim() || actor.userName,
    controlIds: cleanControlIds(input.controlIds),
    mitigationPlan: input.mitigationPlan?.trim() || undefined,
    createdByUserId: actor.userId,
    createdByName: actor.userName,
    createdAt: now,
    updatedAt: now,
  };
  return riskRepository.create(risk);
}

export interface UpdateRiskInput {
  title?: string;
  description?: string;
  category?: string;
  likelihood?: number;
  impact?: number;
  ownerName?: string;
  controlIds?: string[];
  mitigationPlan?: string;
  residualLikelihood?: number | null;
  residualImpact?: number | null;
}

export async function updateRisk(
  actor: ActorContext,
  id: string,
  input: UpdateRiskInput,
): Promise<Risk> {
  if (!can(actor.roles, "update", "risk"))
    throw new ForbiddenError("You are not permitted to edit risks.");
  // An accepted risk still reads "accepted by <approver>"; only someone who could have accepted it
  // may change the scores or plan that acceptance covers.
  const existing = await riskRepository.get(actor.tenantId, id);
  if (!existing) throw new NotFoundError("Risk not found.");
  if (existing.status === "accepted" && !can(actor.roles, "approve", "risk")) {
    throw new ForbiddenError(
      "Changing an accepted risk requires a Risk Manager, Compliance Manager, or Administrator.",
    );
  }
  const updated = await riskRepository.update(actor.tenantId, id, (risk) => ({
    ...risk,
    title: input.title?.trim() || risk.title,
    description:
      input.description === undefined ? risk.description : input.description.trim() || undefined,
    category: input.category === undefined ? risk.category : ensureCategory(input.category),
    likelihood:
      input.likelihood === undefined
        ? risk.likelihood
        : clampScale(input.likelihood, risk.likelihood),
    impact: input.impact === undefined ? risk.impact : clampScale(input.impact, risk.impact),
    ownerName: input.ownerName?.trim() || risk.ownerName,
    controlIds:
      input.controlIds === undefined ? risk.controlIds : cleanControlIds(input.controlIds),
    mitigationPlan:
      input.mitigationPlan === undefined
        ? risk.mitigationPlan
        : input.mitigationPlan.trim() || undefined,
    residualLikelihood:
      input.residualLikelihood === undefined
        ? risk.residualLikelihood
        : input.residualLikelihood == null
          ? undefined
          : clampScale(input.residualLikelihood, 3),
    residualImpact:
      input.residualImpact === undefined
        ? risk.residualImpact
        : input.residualImpact == null
          ? undefined
          : clampScale(input.residualImpact, 3),
    updatedAt: new Date().toISOString(),
  }));
  if (!updated) throw new NotFoundError("Risk not found.");
  return updated;
}

export async function transitionRisk(
  actor: ActorContext,
  id: string,
  to: RiskStatus,
): Promise<Risk> {
  const risk = await riskRepository.get(actor.tenantId, id);
  if (!risk) throw new NotFoundError("Risk not found.");
  if (!canTransitionRisk(risk.status, to)) {
    throw new ValidationError(`Cannot move a ${risk.status} risk to ${to}.`);
  }
  // Accepting residual risk is the consequential gate — it requires approval rights.
  const action = to === "accepted" ? "approve" : "update";
  if (!can(actor.roles, action, "risk")) {
    throw new ForbiddenError(
      to === "accepted"
        ? "Accepting a risk requires a Risk Manager, Compliance Manager, or Administrator."
        : "You are not permitted to change this risk.",
    );
  }
  const updated = await riskRepository.update(actor.tenantId, id, (current) => ({
    ...current,
    status: to,
    acceptedByName: to === "accepted" ? actor.userName : current.acceptedByName,
    acceptedAt: to === "accepted" ? new Date().toISOString() : current.acceptedAt,
    updatedAt: new Date().toISOString(),
  }));
  if (!updated) throw new NotFoundError("Risk not found.");
  return updated;
}

export async function deleteRisk(actor: ActorContext, id: string): Promise<void> {
  if (!can(actor.roles, "delete", "risk"))
    throw new ForbiddenError("You are not permitted to delete risks.");
  const removed = await riskRepository.delete(actor.tenantId, id);
  if (!removed) throw new NotFoundError("Risk not found.");
}
