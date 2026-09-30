/** Browser-side organizations API client. */

import type { InvitedRole } from "@/lib/invitations/types";
import type { Organization, OrganizationMembership, OrganizationTeam } from "./types";

async function parseError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${response.status}).`;
}

export interface MyOrganizations {
  organizations: OrganizationMembership[];
  activeOrganizationId: string;
}

export async function fetchMyOrganizations(): Promise<MyOrganizations> {
  const response = await fetch("/api/organizations", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as MyOrganizations;
}

export interface CreateOrganizationInput {
  name: string;
  orgType: string;
  industry: string;
}

export async function createOrganization(input: CreateOrganizationInput): Promise<void> {
  const response = await fetch("/api/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export interface UpdateOrganizationInput {
  name?: string;
  orgType?: string;
  industry?: string;
}

export async function updateOrganization(input: UpdateOrganizationInput): Promise<Organization> {
  const response = await fetch("/api/organizations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response));
  const data = (await response.json()) as { organization: Organization };
  return data.organization;
}

export async function switchOrganization(organizationId: string): Promise<void> {
  const response = await fetch("/api/organizations/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function fetchOrganizationTeam(): Promise<OrganizationTeam> {
  const response = await fetch("/api/organizations/members", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as OrganizationTeam;
}

export interface InviteTeamMemberResponse {
  inviteLink: string;
  expiresAt: string;
  emailSent: boolean;
}

export async function inviteTeamMember(
  email: string,
  invitedRole: InvitedRole,
): Promise<InviteTeamMemberResponse> {
  const response = await fetch("/api/organizations/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, invitedRole }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as InviteTeamMemberResponse;
}

export async function removeTeamMember(userId: string): Promise<void> {
  const response = await fetch(`/api/organizations/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseError(response));
}

export async function cancelTeamInvitation(invitationId: string): Promise<void> {
  const response = await fetch(`/api/organizations/invitations/${encodeURIComponent(invitationId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseError(response));
}
