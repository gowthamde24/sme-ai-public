"use client";

import { useCallback, useSyncExternalStore } from "react";

import { parseActivity, type ActivityFeed } from "@/lib/activity/types";

export type ActivityState = { feed: ActivityFeed | null; /** When the last good answer arrived (ms): the call's timer counts on from it. */ at: number; status: "loading" | "ok" | "error" | "signed_out" };

const DEFAULT_MS = 10_000;
const MAX_MS = 60_000;
/** A good answer older than this is asked for again at once when the tab comes back to the front. */
const STALE_MS = 15_000;

type Store = { state: ActivityState; listeners: Set<() => void>; stop: (() => void) | null };
const stores = new Map<string, Store>();
const LOADING: ActivityState = { feed: null, at: 0, status: "loading" };

/**
 * The "Live now" strip's data: ONE poll per workspace however many parts of the page show it (the menu and the phone's line both do). It asks `/app/tenants/<id>/activity` every `poll_after_s` the API gives (about 5 to 10 seconds), not at all while the tab is
 * hidden or the phone is offline, straight away when the tab or the connection comes back, and longer after each failure (up to a minute). The last good answer stays on screen through a failure. A rejected session (401) stops it for good.
 * It starts with the first part that shows it and stops with the last.
 */
function start(tenantId: string, store: Store): () => void {
  const url = `/app/tenants/${tenantId}/activity`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let failures = 0;
  let stopped = false;
  const publish = (state: ActivityState) => {
    store.state = state;
    store.listeners.forEach((l) => l());
  };
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (stopped || document.hidden || !navigator.onLine) return; // (the visibility and online events start it again)
    timer = setTimeout(() => void run(), ms);
  };
  const run = async () => {
    if (stopped || controller) return;
    controller = new AbortController();
    let next = DEFAULT_MS;
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
      if (res.status === 401) {
        stopped = true;
        publish({ ...store.state, status: "signed_out" });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const feed = parseActivity(await res.json());
      if (feed === null) throw new Error("shape");
      failures = 0;
      publish({ feed, at: Date.now(), status: "ok" });
      next = feed.pollAfterS ? feed.pollAfterS * 1000 : DEFAULT_MS;
    } catch {
      if (stopped || controller?.signal.aborted) return;
      failures += 1;
      publish({ ...store.state, status: "error" });
      next = Math.min(DEFAULT_MS * 2 ** failures, MAX_MS);
    } finally {
      controller = null;
    }
    schedule(next);
  };
  const wake = () => {
    if (stopped || document.hidden || !navigator.onLine) return;
    if (store.state.status === "ok" && Date.now() - store.state.at < STALE_MS) return schedule(DEFAULT_MS);
    void run();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
  };
}

function subscribeTo(tenantId: string) {
  return (listener: () => void) => {
    let store = stores.get(tenantId);
    if (!store) {
      store = { state: LOADING, listeners: new Set(), stop: null };
      stores.set(tenantId, store);
    }
    store.listeners.add(listener);
    if (store.listeners.size === 1) store.stop = start(tenantId, store);
    return () => {
      store.listeners.delete(listener);
      if (store.listeners.size === 0) {
        store.stop?.();
        stores.delete(tenantId);
      }
    };
  };
}

const NOTHING = () => () => undefined;

/** What the assistant is doing now in this workspace (null feed until the first answer). `enabled` false = not asked at all. */
export function useActivity(tenantId: string | null, enabled: boolean): ActivityState {
  const on = tenantId !== null && enabled;
  // (a stable function per workspace: a new one on every render would unsubscribe and subscribe again, and start the poll over)
  const subscribe = useCallback((listener: () => void) => (on ? subscribeTo(tenantId)(listener) : NOTHING()), [on, tenantId]);
  return useSyncExternalStore(subscribe, () => (on ? (stores.get(tenantId)?.state ?? LOADING) : LOADING), () => LOADING);
}
