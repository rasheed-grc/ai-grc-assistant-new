"use client";

import { createLocalListStore } from "./localListStore";
import { useSession } from "@/components/auth/SessionProvider";
import type { SearchEntityType } from "@/lib/search/types";

export interface FavoriteItem {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle?: string;
  href: string;
  savedAt: string;
}

const store = createLocalListStore<FavoriteItem>({
  storageKey: "sentinel-grc:favorites",
  maxItems: 30,
  itemKey: (item) => `${item.type}:${item.id}`,
});

function keyOf(type: SearchEntityType, id: string): string {
  return `${type}:${id}`;
}

/** `organizationId` scopes the favorite to the organization active when it was saved —
 *  callers get theirs from `useSession().user.organizationId`. */
export function toggleFavorite(item: Omit<FavoriteItem, "savedAt">, organizationId: string) {
  const key = keyOf(item.type, item.id);
  const isSaved = store.read(organizationId).some((i) => keyOf(i.type, i.id) === key);
  if (isSaved) {
    store.remove(organizationId, key);
  } else {
    store.add(organizationId, { ...item, savedAt: new Date().toISOString() });
  }
}

export function useIsFavorite(type: SearchEntityType, id: string): boolean {
  const { user } = useSession();
  const items = store.useItems(user.organizationId);
  return items.some((item) => item.type === type && item.id === id);
}

export function useFavorites(): FavoriteItem[] {
  const { user } = useSession();
  return store.useItems(user.organizationId);
}
