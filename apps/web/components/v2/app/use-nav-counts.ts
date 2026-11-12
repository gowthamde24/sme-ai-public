"use client";

import { useEffect, useSyncExternalStore } from "react";

import { NO_COUNTS, type NavCounts } from "@/lib/nav-counts";
import { retryAfterMs } from "@/lib/net/retry-after";
import { userIdle, whenUserBack } from "@/lib/net/user-idle";

/**
 * The menu's numbers (job sidebar v2; C1's contract docs/contracts/nav-counts.md), shared by the side menu, the phone bar and the More sheet: ONE poll per workspace however many parts draw them. The first ask is made
 * after the page is drawn (never before first paint), then at most every minute while the tab is in front (owner, 12 Nov 2026: staging was slow under the polling), and again when the tab comes back to the front (if the last answer is a minute old). A failed ask keeps
 * the last numbers; before any answer every number is null, so the menu draws no badge (never a made-up one).
 */
export const POLL_MS = 60_000;
/** After a failed ask (any 5xx, "busy" above all) the next one waits twice as long each time, up to this, and never less than the API's Retry-After. A 502 is never asked again at once. */
export const MAX_HOLD_MS = 300_000;

type Entry = { counts: NavCounts; at: number; failures: number; holdUntil: number; busy: boolean; users: number; timer: ReturnType<typeof setInterval> | null; listeners: Set<() => void> };
const entries = new Map<string, Entry>();

function entryOf(tenantId: string): Entry {
  let e = entries.get(tenantId);
  if (!e) {
    e = { counts: NO_COUNTS, at: 0, failures: 0, holdUntil: 0, busy: false, users: 0, timer: null, listeners: new Set() };
    entries.set(tenantId, e);
  }
  return e;
}

/** A failed ask: the next waits twice as long each time (a minute, two, four, up to five), and at least what Retry-After said. */
function hold(e: Entry, retryAfter: string | null): void {
  e.failures += 1;
  e.holdUntil = Date.now() + Math.max(retryAfterMs(retryAfter), Math.min(MAX_HOLD_MS, POLL_MS * 2 ** (e.failures - 1)));
}

async function ask(tenantId: string, force = false): Promise<void> {
  const e = entryOf(tenantId);
  if (e.busy || Date.now() < e.holdUntil || (!force && Date.now() - e.at < POLL_MS)) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (userIdle()) return whenUserBack(`nav-counts:${tenantId}`, () => void ask(tenantId, true)); // (nobody has touched the page for ten minutes: the first touch asks again)
  e.busy = true;
  try {
    const r = await fetch(`/app/tenants/${tenantId}/nav-counts`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (r.ok) {
      const body = (await r.json()) as { counts?: NavCounts };
      if (body && typeof body === "object" && body.counts && typeof body.counts === "object") {
        e.counts = { ...NO_COUNTS, ...body.counts };
        e.at = Date.now();
        e.failures = 0;
        e.holdUntil = 0;
        e.listeners.forEach((l) => l());
      }
    } else if (r.status >= 500) {
      hold(e, r.headers.get("Retry-After"));
    }
  } catch {
    // the last numbers stay: a menu badge is a convenience
    hold(e, null);
  } finally {
    e.busy = false;
  }
}

/** Starts (or joins) the workspace's poll; the last part to leave stops it. */
function join(tenantId: string): () => void {
  const e = entryOf(tenantId);
  e.users += 1;
  if (e.users === 1) {
    // after the page is drawn: the next task, not this render
    setTimeout(() => void ask(tenantId), 0);
    e.timer = setInterval(() => void ask(tenantId), POLL_MS);
  }
  const back = () => {
    if (document.visibilityState === "visible") void ask(tenantId);
  };
  document.addEventListener("visibilitychange", back);
  window.addEventListener("focus", back);
  return () => {
    document.removeEventListener("visibilitychange", back);
    window.removeEventListener("focus", back);
    e.users -= 1;
    if (e.users === 0 && e.timer) {
      clearInterval(e.timer);
      e.timer = null;
    }
  };
}

/** The numbers for the workspace (null id: outside a workspace, nothing is asked). */
export function useNavCounts(tenantId: string | null): NavCounts {
  useEffect(() => (tenantId ? join(tenantId) : undefined), [tenantId]);
  return useSyncExternalStore(
    (l) => {
      if (!tenantId) return () => undefined;
      const e = entryOf(tenantId);
      e.listeners.add(l);
      return () => void e.listeners.delete(l);
    },
    () => (tenantId ? entryOf(tenantId).counts : NO_COUNTS),
    () => NO_COUNTS,
  );
}

/** Tests only: forget every workspace's numbers and polls. */
export function resetNavCountsForTests(): void {
  for (const e of entries.values()) if (e.timer) clearInterval(e.timer);
  entries.clear();
}
