"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  attachPlanItemEvidence,
  completePlanItem,
  fetchActivePlan,
  fetchCurrentMaturity,
  fetchPlanItemEvents,
  fetchPlanVersions,
  reopenPlanItem,
  startPlanItem,
} from "@/lib/planExecution/client";
import type { CurrentMaturity, GovernancePlan, PlanDetail, PlanEvent, PlanItem } from "@/lib/planExecution/types";

const PLAN_KEY = ["governancePlan", "active"] as const;
const VERSIONS_KEY = ["governancePlan", "versions"] as const;
const MATURITY_KEY = ["governancePlan", "maturity"] as const;

export function useActivePlan() {
  return useQuery<PlanDetail | null>({ queryKey: PLAN_KEY, queryFn: fetchActivePlan });
}

export function usePlanVersions() {
  return useQuery<GovernancePlan[]>({ queryKey: VERSIONS_KEY, queryFn: fetchPlanVersions });
}

export function useCurrentMaturity() {
  return useQuery<CurrentMaturity>({ queryKey: MATURITY_KEY, queryFn: fetchCurrentMaturity });
}

export function usePlanItemEvents(itemId: string | null) {
  return useQuery<PlanEvent[]>({
    queryKey: ["governancePlan", "events", itemId],
    queryFn: () => fetchPlanItemEvents(itemId as string),
    enabled: Boolean(itemId),
  });
}

/** The sections above the board (status, "what to do next", activity, evidence, maturity) are
 * Server Components: query invalidation never reaches them, so without a refresh they keep
 * counting a completed step as remaining until the page is reloaded. */
function useRefreshServerSections() {
  const router = useRouter();
  return () => router.refresh();
}

/** Any item status transition moves both the plan (item list) and the live maturity
 * recalculation (ADR 0066 §5.3) — invalidate both together so the UI never shows a stale score
 * next to a status that has already changed. */
function useInvalidatePlanAndMaturity() {
  const queryClient = useQueryClient();
  const refreshServerSections = useRefreshServerSections();
  return () => {
    void queryClient.invalidateQueries({ queryKey: PLAN_KEY });
    void queryClient.invalidateQueries({ queryKey: MATURITY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["governancePlan", "events"] });
    refreshServerSections();
  };
}

export function useStartPlanItem() {
  const invalidate = useInvalidatePlanAndMaturity();
  return useMutation<PlanItem, Error, string>({
    mutationFn: (itemId) => startPlanItem(itemId),
    onSuccess: invalidate,
  });
}

export function useCompletePlanItem() {
  const invalidate = useInvalidatePlanAndMaturity();
  return useMutation<PlanItem, Error, string>({
    mutationFn: (itemId) => completePlanItem(itemId),
    onSuccess: invalidate,
  });
}

export function useReopenPlanItem() {
  const invalidate = useInvalidatePlanAndMaturity();
  return useMutation<PlanItem, Error, string>({
    mutationFn: (itemId) => reopenPlanItem(itemId),
    onSuccess: invalidate,
  });
}

export function useAttachPlanItemEvidence() {
  const queryClient = useQueryClient();
  const refreshServerSections = useRefreshServerSections();
  return useMutation<PlanItem, Error, { itemId: string; evidenceIds: string[] }>({
    mutationFn: ({ itemId, evidenceIds }) => attachPlanItemEvidence(itemId, evidenceIds),
    onSuccess: () => {
      // Evidence never changes status/maturity (ADR 0066 §5.4) — only the item list needs a
      // refresh, not the maturity recalculation.
      void queryClient.invalidateQueries({ queryKey: PLAN_KEY });
      void queryClient.invalidateQueries({ queryKey: ["governancePlan", "events"] });
      refreshServerSections();
    },
  });
}
