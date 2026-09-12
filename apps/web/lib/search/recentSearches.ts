"use client";

import { createLocalListStore } from "@/lib/workspace/localListStore";
import { useSession } from "@/components/auth/SessionProvider";

const store = createLocalListStore<string>({
  storageKey: "sentinel-grc:recent-searches",
  maxItems: 6,
  itemKey: (query) => query.toLowerCase(),
});

/** `organizationId` scopes the search history to the organization active when it was
 *  searched — callers get theirs from `useSession().user.organizationId`. */
export function addRecentSearch(query: string, organizationId: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  store.add(organizationId, trimmed);
}

export function removeRecentSearch(query: string, organizationId: string) {
  store.remove(organizationId, query.toLowerCase());
}

export function clearRecentSearches(organizationId: string) {
  store.clear(organizationId);
}

export function useRecentSearches(): string[] {
  const { user } = useSession();
  return store.useItems(user.organizationId);
}
