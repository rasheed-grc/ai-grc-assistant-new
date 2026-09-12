"use client";

import { useCallback, useSyncExternalStore } from "react";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * A small localStorage-backed, most-recent-first list store, shared by recent searches,
 * recently-viewed items, and favorites (V2-P3 Milestone 6). Client-only, per-browser
 * persistence — a genuine, working feature, not a stand-in for a backend: there is no
 * `saved_items`/`search_history` Tool or table yet (flagged as future scope in the V2-P3
 * design proposal §9/§10), so this is the honest frontend-only version of "remember this
 * for me," scoped to the current browser rather than synced across devices.
 *
 * Every read/write is scoped by a caller-supplied `scope` string (the current
 * organization's id). Org switching in this app re-issues the session cookie and does a
 * full page reload rather than clearing client storage, so without this scoping a
 * favorite/recently-viewed/recent-search saved under one organization would keep showing
 * up after switching to another — a real cross-tenant leak in the browser, not just a
 * stale-UI issue (post-launch audit finding). Each scope gets its own localStorage key
 * and its own in-memory cache/listener set.
 */
export function createLocalListStore<T>(options: {
  storageKey: string;
  maxItems: number;
  itemKey: (item: T) => string;
}) {
  const { storageKey, maxItems, itemKey } = options;
  const emptySnapshot: T[] = [];

  interface ScopeState {
    // `useSyncExternalStore` requires `getSnapshot` to return a referentially stable
    // value when nothing has changed — re-parsing localStorage on every call would hand
    // back a new array each time and trip React's "getSnapshot should be cached"
    // infinite-loop guard. `cache` is that stable snapshot; it's only replaced (once)
    // inside `write`.
    cache: T[] | null;
    listeners: Set<() => void>;
  }
  const scopes = new Map<string, ScopeState>();

  function stateFor(scope: string): ScopeState {
    let state = scopes.get(scope);
    if (!state) {
      state = { cache: null, listeners: new Set() };
      scopes.set(scope, state);
    }
    return state;
  }

  function keyFor(scope: string): string {
    return `${storageKey}:${scope}`;
  }

  function readFromStorage(scope: string): T[] {
    if (typeof window === "undefined") return emptySnapshot;
    return safeParse<T[]>(window.localStorage.getItem(keyFor(scope)), emptySnapshot);
  }

  /** The current list for `scope`. Safe to call anytime; does not re-read storage once cached. */
  function read(scope: string): T[] {
    const state = stateFor(scope);
    if (state.cache === null) state.cache = readFromStorage(scope);
    return state.cache;
  }

  function write(scope: string, items: T[]) {
    const state = stateFor(scope);
    state.cache = items;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(keyFor(scope), JSON.stringify(items));
    }
    state.listeners.forEach((listener) => listener());
  }

  function subscribe(scope: string, listener: () => void) {
    const state = stateFor(scope);
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  function add(scope: string, item: T) {
    const key = itemKey(item);
    const existing = read(scope).filter((i) => itemKey(i) !== key);
    write(scope, [item, ...existing].slice(0, maxItems));
  }

  function remove(scope: string, key: string) {
    write(scope, read(scope).filter((i) => itemKey(i) !== key));
  }

  function clear(scope: string) {
    write(scope, emptySnapshot);
  }

  function useItems(scope: string): T[] {
    const subscribeToScope = useCallback((listener: () => void) => subscribe(scope, listener), [scope]);
    const readScope = useCallback(() => read(scope), [scope]);
    return useSyncExternalStore(subscribeToScope, readScope, () => emptySnapshot);
  }

  return { add, remove, clear, read, useItems };
}
