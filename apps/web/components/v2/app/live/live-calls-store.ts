"use client";

import { useCallback, useSyncExternalStore } from "react";

import { parseLiveWire, type LiveCall } from "@/lib/live-calls/model";
import { retryAfterMs } from "@/lib/net/retry-after";

import { pingWanted } from "./call-ping";

export type LiveCallsState = { calls: LiveCall[]; /** When the last good answer arrived (ms): the clock counts on from it. */ at: number; status: "loading" | "ok" | "error" | "stopped" };
type Store = { state: LiveCallsState; listeners: Set<() => void>; stop: (() => void) | null };
const stores = new Map<string, Store>();
const LOADING: LiveCallsState = { calls: [], at: 0, status: "loading" };
const DEFAULT_MS = 5_000;
const MAX_MS = 60_000;
const STALE_MS = 10_000;
/** Nothing live and not on a calls screen (owner, 12 Nov 2026: staging was slow under the polling): a new call is looked for only this often. */
const IDLE_MS = 30_000;
/** The calls screens: the list of calls, one call, and the live ones. Everywhere else the bar only waits for a call to start. */
const onCallsScreen = (tenantId: string): boolean => typeof window !== "undefined" && new RegExp(`^/app/tenants/${tenantId}/(calls|call-list|office)(/|$)`).test(window.location.pathname);
/** Fast (the API's own `poll_after_s`) while a call is live or a calls screen is open, else slow. */
const gapFor = (tenantId: string, liveCount: number, wanted: number): number => (liveCount > 0 || onCallsScreen(tenantId) ? wanted : Math.max(wanted, IDLE_MS));

/**
 * The live-call bar's data: ONE poll per workspace however many parts show it. Asks `/app/tenants/<id>/live-calls` every `poll_after_s` (5 s) while a call is live or a calls screen is open, otherwise every 30 s, only while the tab is in front and the phone online, at once when it comes back, slower after each
 * failure (up to a minute), and for good after a 401 or a 404 (signed out, or a role with no calls). A failed poll hides the bar (nothing stale is shown).
 */
function start(tenantId: string, store: Store): () => void {
  const url = `/app/tenants/${tenantId}/live-calls`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let failures = 0;
  let stopped = false;
  const publish = (state: LiveCallsState) => {
    store.state = state;
    store.listeners.forEach((l) => l());
  };
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (stopped || !navigator.onLine) return;
    // a tab behind others asks only while the person wants the "a call started" notification, and then slowly
    if (document.hidden && !pingWanted()) return;
    timer = setTimeout(() => void run(), document.hidden ? Math.max(ms, 15_000) : ms);
  };
  const run = async () => {
    if (stopped || controller) return;
    controller = new AbortController();
    let next = DEFAULT_MS;
    let retryAfter = 0;
    try {
      const res = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
      if (res.status === 401 || res.status === 404 || res.status === 403) {
        stopped = true;
        publish({ calls: [], at: Date.now(), status: "stopped" });
        return;
      }
      if (!res.ok) {
        retryAfter = retryAfterMs(res.headers.get("Retry-After"));
        throw new Error(String(res.status));
      }
      const wire = parseLiveWire(await res.json());
      if (wire === null) throw new Error("shape");
      failures = 0;
      publish({ calls: wire.calls, at: Date.now(), status: "ok" });
      next = gapFor(tenantId, wire.calls.length, wire.pollAfterS * 1000);
    } catch {
      if (stopped || controller?.signal.aborted) return;
      failures += 1;
      publish({ calls: [], at: store.state.at, status: "error" }); // (the bar is hidden: no stale call is ever shown)
      next = Math.max(retryAfter, Math.min(DEFAULT_MS * 2 ** failures, MAX_MS)); // (any failure, "busy" above all, is asked again later, never at once; Retry-After is a floor)
    } finally {
      controller = null;
    }
    schedule(next);
  };
  const wake = () => {
    if (stopped || document.hidden || !navigator.onLine) return;
    if (store.state.status === "ok" && Date.now() - store.state.at < STALE_MS) return schedule(gapFor(tenantId, store.state.calls.length, DEFAULT_MS));
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

/** The calls live now in this workspace (empty until the first answer). `enabled` false = not asked at all. */
export function useLiveCalls(tenantId: string | null, enabled: boolean): LiveCallsState {
  const on = tenantId !== null && enabled;
  const subscribe = useCallback((listener: () => void) => (on ? subscribeTo(tenantId)(listener) : NOTHING()), [on, tenantId]);
  return useSyncExternalStore(subscribe, () => (on ? (stores.get(tenantId)?.state ?? LOADING) : LOADING), () => LOADING);
}
