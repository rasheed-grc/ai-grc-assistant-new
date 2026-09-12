"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMission,
  fetchMission,
  fetchMissionResult,
  fetchMissions,
  runMission,
} from "@/lib/missions/client";
import type { CreatedMission, Mission, MissionDetail, MissionResult, StartableMissionType } from "@/lib/missions/types";

const MISSIONS_KEY = ["missions"] as const;
const MISSION_KEY = (id: string) => ["missions", id] as const;
const MISSION_RESULT_KEY = (id: string) => ["missions", id, "result"] as const;

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "archived"]);

export function useMissions() {
  return useQuery<Mission[]>({
    queryKey: MISSIONS_KEY,
    queryFn: fetchMissions,
  });
}

/** Polls while the mission is still running — the only state that changes without the viewer
 * doing anything — and stops the instant it reaches a terminal status (or is still only
 * `planned`/`created`, i.e. nobody has pressed Execute yet, so there is nothing to wait for). */
export function useMission(missionId: string) {
  return useQuery<MissionDetail>({
    queryKey: MISSION_KEY(missionId),
    queryFn: () => fetchMission(missionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || TERMINAL_STATUSES.has(status)) return false;
      return status === "executing" || status === "resumed" ? 2000 : false;
    },
  });
}

export function useCreateMission() {
  const queryClient = useQueryClient();
  return useMutation<CreatedMission, Error, { type: StartableMissionType; scope: string }>({
    mutationFn: ({ type, scope }) => createMission(type, scope),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MISSIONS_KEY }),
  });
}

export function useRunMission(missionId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ status: string; awaitingApproval: boolean }, Error, void>({
    mutationFn: () => runMission(missionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MISSION_KEY(missionId) });
      queryClient.invalidateQueries({ queryKey: MISSIONS_KEY });
    },
  });
}

/** Only meaningful once the mission has completed; callers gate `enabled` on that themselves so a
 * 409 (not ready) never surfaces as a query error while the mission is still running. */
export function useMissionResult(missionId: string, enabled: boolean) {
  return useQuery<MissionResult>({
    queryKey: MISSION_RESULT_KEY(missionId),
    queryFn: () => fetchMissionResult(missionId),
    enabled,
  });
}
