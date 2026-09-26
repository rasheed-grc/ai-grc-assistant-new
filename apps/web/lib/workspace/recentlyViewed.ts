"use client";

import { createLocalListStore } from "./localListStore";
import { useSession } from "@/components/auth/SessionProvider";
import type { SearchEntityType } from "@/lib/search/types";

export interface RecentlyViewedItem {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle?: string;
  href: string;
  viewedAt: string;
}

const store = createLocalListStore<RecentlyViewedItem>({
  storageKey: "sentinel-grc:recently-viewed",
  maxItems: 8,
  itemKey: (item) => `${item.type}:${item.id}`,
});

/** Call from a detail view's mount effect to record "the user just opened this."
 *  `organizationId` scopes the entry to the organization active at the time — callers get
 *  theirs from `useSession().user.organizationId`. */
export function recordVisit(item: Omit<RecentlyViewedItem, "viewedAt">, organizationId: string) {
  store.add(organizationId, { ...item, viewedAt: new Date().toISOString() });
}

export function useRecentlyViewed(): RecentlyViewedItem[] {
  const { user } = useSession();
  return store.useItems(user.organizationId);
}
