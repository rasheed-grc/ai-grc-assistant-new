/**
 * Organization membership + creation. Any authenticated user may create a new organization
 * (self-service tenant creation) and becomes its owner; switching requires actual
 * membership, verified against `user_organizations` — never trust a client-supplied
 * organization id without checking it (CLAUDE.md §20, default deny).
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { ActorContext } from "@/lib/auth/actor";
import { INVITED_ROLES, type InvitedRole } from "@/lib/invitations/types";
import { createInvitation, type CreatedInvitation } from "@/lib/invitations/service";
import { invitationRepository } from "@/lib/invitations/repository";
import { sendTeamInvitationEmail } from "@/lib/email";
import { usersRepository } from "@/lib/users/repository";
import { organizationRepository } from "./repository";
import type { Organization, OrganizationMembership, OrganizationTeam } from "./types";


export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Company name is required.").max(200),
  orgType: z.string().trim().min(1, "Company type is required.").max(120),
  industry: z.string().trim().min(1, "Company activity/industry is required.").max(120),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export async function listMyOrganizations(actor: ActorContext): Promise<OrganizationMembership[]> {
  return organizationRepository.listForUser(actor.userId);
}

export async function createOrganization(
  actor: ActorContext,
  input: unknown,
): Promise<Organization> {
  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid organization details.");
  }
  const org: Organization = {
    id: randomUUID(),
    name: parsed.data.name,
    orgType: parsed.data.orgType,
    industry: parsed.data.industry,
    createdByUserId: actor.userId,
    createdAt: new Date().toISOString(),
  };
  await organizationRepository.create(org);
  await organizationRepository.addMember(actor.userId, org.id, "owner");
  return org;
}

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Company name is required.").max(200).optional(),
  orgType: z.string().trim().min(1, "Company type is required.").max(120).optional(),
  industry: z.string().trim().min(1, "Company activity/industry is required.").max(120).optional(),
});

/**
 * Updates the caller's *current* organization (`actor.tenantId`) — never a client-supplied id,
 * so this can only ever touch the tenant the caller is already scoped to. Owner/admin only,
 * matching `inviteTeamMember`'s gate (organization-level actions aren't in the `can()` resource
 * vocabulary, same as that function).
 */
export async function updateOrganization(actor: ActorContext, input: unknown): Promise<Organization> {
  if (!actor.roles.includes("owner") && !actor.roles.includes("admin")) {
    throw new ForbiddenError("Only workspace owners and admins may update organization details.");
  }
  const parsed = updateOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid organization details.");
  }
  const updated = await organizationRepository.update(actor.tenantId, parsed.data);
  if (!updated) throw new NotFoundError("Organization not found.");
  return updated;
}

/** Verifies membership before a session switch; throws if the user does not belong. */
export async function assertMembership(
  actor: ActorContext,
  organizationId: string,
): Promise<OrganizationMembership> {
  const membership = await organizationRepository.getMembership(actor.userId, organizationId);
  if (!membership) {
    throw new ForbiddenError("You are not a member of this organization.");
  }
  return membership;
}

export const inviteTeamMemberSchema = z.object({
  email: z.string().trim().email("A valid email is required."),
  invitedRole: z.enum(INVITED_ROLES),
});

export interface InviteTeamMemberResult {
  invitation: CreatedInvitation["invitation"];
  /** The raw invite token — surface once, in this response, for the admin to copy/send. */
  token: string;
  inviteLink: string;
  /** Whether the invitation email actually went out. The admin-visible copyable link is the
   * fallback: a mail-provider failure must never block the invite or hide the link. */
  emailSent: boolean;
}

/**
 * Invites someone into the caller's *current* organization (`actor.tenantId` — never a
 * client-supplied id, so there is no way to target another tenant's team). Owner/admin only;
 * `invitedRole` must be one of `INVITED_ROLES` or this rejects with a 400 — never silently
 * substitutes a role. `baseUrl` is the incoming request's own origin, supplied by the route
 * handler (this service has no request context of its own), matching
 * `accessRequests/service.ts#approveAccessRequest`.
 */
export async function inviteTeamMember(
  actor: ActorContext,
  input: unknown,
  baseUrl: string,
): Promise<InviteTeamMemberResult> {
  if (!actor.roles.includes("owner") && !actor.roles.includes("admin")) {
    throw new ForbiddenError("Only workspace owners and admins may invite teammates.");
  }
  const parsed = inviteTeamMemberSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid invite details.");
  }
  const email = parsed.data.email.toLowerCase();
  const invitedRole: InvitedRole = parsed.data.invitedRole;

  const org = await organizationRepository.get(actor.tenantId);
  if (!org) throw new NotFoundError("Organization not found.");

  const existingUser = await usersRepository.findByEmail(email);
  if (existingUser) {
    throw new ValidationError("An account with this email already exists.");
  }
  // Idempotent: a still-open invite for this email in this org is returned as an error
  // rather than silently creating a duplicate. Unlike submitAccessRequest's "return the
  // existing one" idempotency, we can't do that here — only the token *hash* is stored, so
  // a pre-existing invite has no usable link left to hand back.
  const existingInvite = await invitationRepository.findPendingForOrganizationAndEmail(
    actor.tenantId,
    email,
  );
  if (existingInvite) {
    throw new ValidationError("An invitation is already pending for this email.");
  }

  const { invitation, token } = await createInvitation({
    email,
    organizationName: org.name,
    invitedRole,
    organizationId: actor.tenantId,
  });

  const inviteLink = new URL(
    `/accept-invite?token=${encodeURIComponent(token)}`,
    baseUrl,
  ).toString();

  const emailResult = await sendTeamInvitationEmail(email, {
    organizationName: org.name,
    inviteLink,
  });

  return { invitation, token, inviteLink, emailSent: emailResult.success };
}

/** Real members plus any still-open invitations for the caller's current organization —
 * backs the Settings > Team page. Any member may view their own team (not owner/admin only;
 * inviting is the privileged action, not seeing who's already there). */
export async function listOrganizationMembers(actor: ActorContext): Promise<OrganizationTeam> {
  const [members, pending] = await Promise.all([
    organizationRepository.listMembers(actor.tenantId),
    invitationRepository.listPendingForOrganization(actor.tenantId),
  ]);
  return {
    members,
    pendingInvitations: pending.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      invitedRole: invitation.invitedRole,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })),
  };
}

function assertCanManageTeam(actor: ActorContext): void {
  if (!actor.roles.includes("owner") && !actor.roles.includes("admin")) {
    throw new ForbiddenError("Only workspace owners and admins may manage the team.");
  }
}

/**
 * Removes a teammate from the caller's *current* organization (never a client-supplied one).
 * Their account and any other organization they belong to are untouched; this org's data stays.
 * Access ends immediately: `getSession()` re-checks membership on every request, so the removed
 * person's still-signed cookie stops working at once instead of at expiry.
 *
 * Guards: owner/admin only; no removing yourself (leave by asking another owner); an admin cannot
 * remove an owner; and the last owner can never be removed — an organization with nobody able to
 * administer it is unrecoverable.
 */
export async function removeTeamMember(actor: ActorContext, targetUserId: string): Promise<void> {
  assertCanManageTeam(actor);
  if (targetUserId === actor.userId) {
    throw new ValidationError("You can't remove yourself. Ask another owner to do it.");
  }
  const target = await organizationRepository.getMembership(targetUserId, actor.tenantId);
  if (!target) throw new NotFoundError("That person is not a member of this organization.");
  if (target.role === "owner") {
    if (!actor.roles.includes("owner")) {
      throw new ForbiddenError("Only an owner can remove another owner.");
    }
    if ((await organizationRepository.countMembersWithRole(actor.tenantId, "owner")) <= 1) {
      throw new ValidationError("An organization must keep at least one owner.");
    }
  }
  await organizationRepository.removeMember(targetUserId, actor.tenantId);
}

/** Cancels a still-open invitation in the caller's current organization. */
export async function cancelInvitation(actor: ActorContext, invitationId: string): Promise<void> {
  assertCanManageTeam(actor);
  const revoked = await invitationRepository.revokePending(actor.tenantId, invitationId);
  if (!revoked) throw new NotFoundError("That invitation is not open.");
}
