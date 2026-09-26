/** Browser-side Missions API client — calls this app's own `/api/missions` routes. */

import type { CreatedMission, Mission, MissionDetail, MissionResult, StartableMissionType } from "./types";

async function parseError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${response.status}).`;
}

export async function fetchMissions(): Promise<Mission[]> {
  const response = await fetch("/api/missions", { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { missions: Mission[] }).missions;
}

export async function fetchMission(missionId: string): Promise<MissionDetail> {
  const response = await fetch(`/api/missions/${missionId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { mission: MissionDetail }).mission;
}

export async function createMission(
  type: StartableMissionType,
  scope: string,
): Promise<CreatedMission> {
  const response = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, scope }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as CreatedMission;
}

export async function runMission(
  missionId: string,
): Promise<{ status: string; awaitingApproval: boolean }> {
  const response = await fetch(`/api/missions/${missionId}/run`, { method: "POST" });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as { status: string; awaitingApproval: boolean };
}

/** Throws with `code: "conflict"` while the mission isn't finished yet — callers distinguish that
 * from a real failure and keep polling `fetchMission` instead. */
export async function fetchMissionResult(missionId: string): Promise<MissionResult> {
  const response = await fetch(`/api/missions/${missionId}/result`, { cache: "no-store" });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    const error = new Error(data.error ?? `Request failed (${response.status}).`) as Error & {
      code?: string;
    };
    error.code = data.code;
    throw error;
  }
  return ((await response.json()) as { result: MissionResult }).result;
}
