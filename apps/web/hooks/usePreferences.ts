"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchPreferences,
  markNotificationsRead,
  savePreferences,
  type PreferencesInput,
} from "@/lib/preferences/client";
import type { NotificationsFeed, UserPreferences } from "@/lib/preferences/types";

const PREFERENCES_KEY = ["preferences"] as const;
const NOTIFICATIONS_KEY = ["notifications"] as const;

export function usePreferences() {
  return useQuery<UserPreferences>({ queryKey: PREFERENCES_KEY, queryFn: fetchPreferences });
}

export function useSavePreferences() {
  const queryClient = useQueryClient();
  return useMutation<UserPreferences, Error, PreferencesInput>({
    mutationFn: savePreferences,
    onSuccess: (preferences) => {
      queryClient.setQueryData(PREFERENCES_KEY, preferences);
      // What counts as a notification depends on the categories just saved.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}

/** Polls gently: the bell reflects missions that changed while the tab stayed open. */
export function useNotifications() {
  return useQuery<NotificationsFeed>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: fetchNotifications,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: markNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
