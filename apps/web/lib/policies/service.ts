/**
 * Policy application service. Authoring + an approval workflow: drafting and review require
 * author rights; **publishing requires the `publish` permission** (a human gate — only
 * owners/admins/compliance managers can publish). Tenant-scoped. Node-only.
 */

import { randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import type { ActorContext } from "@/lib/auth/actor";
import { isKnownControl } from "@/lib/frameworks/catalog";
import { policyRepository } from "./repository";
import { canTransition, type Policy, type PolicyStatus } from "./types";

function cleanControlIds(controlIds?: string[]): string[] {
  return Array.from(new Set((controlIds ?? []).filter(isKnownControl))).slice(0, 50);
}

export async function listPolicies(actor: ActorContext): Promise<Policy[]> {
  if (!can(actor.roles, "read", "policy"))
    throw new ForbiddenError("You are not permitted to view policies.");
  return policyRepository.list(actor.tenantId);
}

export async function getPolicy(actor: ActorContext, id: string): Promise<Policy> {
  if (!can(actor.roles, "read", "policy"))
    throw new ForbiddenError("You are not permitted to view policies.");
  const policy = await policyRepository.get(actor.tenantId, id);
  if (!policy) throw new NotFoundError("Policy not found.");
  return policy;
}

export interface CreatePolicyInput {
  title: string;
  summary?: string;
  body?: string;
  ownerName?: string;
  controlIds?: string[];
}

export async function createPolicy(actor: ActorContext, input: CreatePolicyInput): Promise<Policy> {
  if (!can(actor.roles, "create", "policy"))
    throw new ForbiddenError("You are not permitted to create policies.");
  const title = input.title.trim();
  if (!title) throw new ValidationError("A title is required.");

  const now = new Date().toISOString();
  const policy: Policy = {
    id: randomUUID(),
    tenantId: actor.tenantId,
    title,
    summary: input.summary?.trim() || undefined,
    body: input.body?.trim() || undefined,
    status: "draft",
    ownerName: input.ownerName?.trim() || actor.userName,
    controlIds: cleanControlIds(input.controlIds),
    createdByUserId: actor.userId,
    createdByName: actor.userName,
    createdAt: now,
    updatedAt: now,
  };
  return policyRepository.create(policy);
}

export interface UpdatePolicyInput {
  title?: string;
  summary?: string;
  body?: string;
  ownerName?: string;
  controlIds?: string[];
}

export async function updatePolicy(
  actor: ActorContext,
  id: string,
  input: UpdatePolicyInput,
): Promise<Policy> {
  if (!can(actor.roles, "update", "policy"))
    throw new ForbiddenError("You are not permitted to edit policies.");
  // A published policy still reads "published by <approver>"; only someone who could have approved
  // it may change what that approval now covers.
  const existing = await policyRepository.get(actor.tenantId, id);
  if (!existing) throw new NotFoundError("Policy not found.");
  if (existing.status === "published" && !can(actor.roles, "publish", "policy")) {
    throw new ForbiddenError(
      "Changing a published policy requires an Owner, Administrator, or Compliance Manager.",
    );
  }
  const updated = await policyRepository.update(actor.tenantId, id, (policy) => ({
    ...policy,
    title: input.title?.trim() || policy.title,
    summary: input.summary === undefined ? policy.summary : input.summary.trim() || undefined,
    body: input.body === undefined ? policy.body : input.body.trim() || undefined,
    ownerName: input.ownerName?.trim() || policy.ownerName,
    controlIds:
      input.controlIds === undefined ? policy.controlIds : cleanControlIds(input.controlIds),
    updatedAt: new Date().toISOString(),
  }));
  if (!updated) throw new NotFoundError("Policy not found.");
  return updated;
}

export async function transitionPolicy(
  actor: ActorContext,
  id: string,
  to: PolicyStatus,
): Promise<Policy> {
  const policy = await policyRepository.get(actor.tenantId, id);
  if (!policy) throw new NotFoundError("Policy not found.");
  if (!canTransition(policy.status, to)) {
    throw new ValidationError(`Cannot move a ${policy.status} policy to ${to}.`);
  }
  // Publishing is the consequential gate: it requires the publish permission. So does taking a
  // published policy back out (to draft or archive) — that withdraws an approval.
  const action = to === "published" || policy.status === "published" ? "publish" : "update";
  if (!can(actor.roles, action, "policy")) {
    throw new ForbiddenError(
      to === "published"
        ? "Publishing a policy requires an Owner, Administrator, or Compliance Manager."
        : policy.status === "published"
          ? "Withdrawing a published policy requires an Owner, Administrator, or Compliance Manager."
          : "You are not permitted to change this policy.",
    );
  }
  const updated = await policyRepository.update(actor.tenantId, id, (current) => ({
    ...current,
    status: to,
    approvedByName: to === "published" ? actor.userName : current.approvedByName,
    approvedAt: to === "published" ? new Date().toISOString() : current.approvedAt,
    updatedAt: new Date().toISOString(),
  }));
  if (!updated) throw new NotFoundError("Policy not found.");
  return updated;
}

export async function deletePolicy(actor: ActorContext, id: string): Promise<void> {
  if (!can(actor.roles, "delete", "policy"))
    throw new ForbiddenError("You are not permitted to delete policies.");
  const removed = await policyRepository.delete(actor.tenantId, id);
  if (!removed) throw new NotFoundError("Policy not found.");
}
