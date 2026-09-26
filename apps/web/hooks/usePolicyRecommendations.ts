"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dismissRecommendation,
  draftFromRecommendation,
  fetchRecommendations,
  generateRecommendations,
} from "@/lib/policyRecommendations/client";
import type { PolicyRecommendation } from "@/lib/policyRecommendations/types";

const RECOMMENDATIONS_KEY = ["policy-recommendations"] as const;
const POLICIES_KEY = ["policies"] as const;

export function usePolicyRecommendations() {
  return useQuery<PolicyRecommendation[]>({
    queryKey: RECOMMENDATIONS_KEY,
    queryFn: fetchRecommendations,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: RECOMMENDATIONS_KEY });
}

export function useGenerateRecommendations() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: generateRecommendations,
    onSuccess: invalidate,
  });
}

export function useDraftFromRecommendation() {
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => draftFromRecommendation(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: POLICIES_KEY });
    },
  });
}

export function useDismissRecommendation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => dismissRecommendation(id),
    onSuccess: invalidate,
  });
}
