/**
 * The actor context an API request runs under — the frontend analogue of the backend's
 * `ExecutionContext`/`Principal`. Carries tenant + identity + roles so services can scope
 * data and enforce RBAC. Server-only (reads the session cookie).
 */

import { getSession } from "./server";
import type { UserRole } from "./roles";

export interface ActorContext {
  userId: string;
  userName: string;
  /** The person's email. Carried because some authority is configured by naming people, and a
   * list of UUIDs is a list an operator cannot check (ADR 0067's knowledge approvers). */
  userEmail: string;
  tenantId: string;
  /** The organization's display name — e.g. for report headers, which must show a name a human
   *  reads, never the raw tenant id (a bug found while building the General GRC Report: every
   *  report's "organization" line was literally rendering the tenant UUID). */
  organizationName: string;
  roles: UserRole[];
  /** Backend bearer token for this actor (used when proxying to the FastAPI API). */
  apiToken: string;
}

export async function getActor(): Promise<ActorContext | null> {
  const session = await getSession();
  if (!session) return null;
  return {
    userId: session.userId,
    userName: session.name,
    userEmail: session.email,
    tenantId: session.organizationId,
    organizationName: session.organizationName,
    roles: session.roles,
    apiToken: session.apiToken,
  };
}
