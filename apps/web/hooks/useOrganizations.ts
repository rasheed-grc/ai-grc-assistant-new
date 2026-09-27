"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMyOrganizations,
  fetchOrganizationTeam,
  inviteTeamMember,
  removeTeamMember,
  cancelTeamInvitation,
  updateOrganization,
  type InviteTeamMemberResponse,
  type UpdateOrganizationInput,
} from "@/lib/organizations/client";
import type { Organization, OrganizationTeam } from "@/lib/organizations/types";
import type { InvitedRole } from "@/lib/invitations/types";

const ORGANIZATIONS_KEY = ["organizations"] as const;
const TEAM_KEY = ["organizations", "team"] as const;

export function useOrganizations() {
  return useQuery({
    queryKey: ORGANIZATIONS_KEY,
    queryFn: fetchMyOrganizations,
  });
}

export function useOrganizationTeam() {
  return useQuery<OrganizationTeam>({
    queryKey: TEAM_KEY,
    queryFn: fetchOrganizationTeam,
  });
}

export function useInviteTeamMember() {
  const queryClient = useQueryClient();
  return useMutation<InviteTeamMemberResponse, Error, { email: string; invitedRole: InvitedRole }>({
    mutationFn: ({ email, invitedRole }) => inviteTeamMember(email, invitedRole),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAM_KEY }),
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation<Organization, Error, UpdateOrganizationInput>({
    mutationFn: (input) => updateOrganization(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_KEY }),
  });
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => removeTeamMember(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAM_KEY }),
  });
}

export function useCancelTeamInvitation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (invitationId) => cancelTeamInvitation(invitationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAM_KEY }),
  });
}
