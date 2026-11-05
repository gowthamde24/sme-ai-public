"use client";

import { useEffect, useSyncExternalStore } from "react";

import { NO_COUNTS, type NavCounts } from "@/lib/nav-counts";

/**
 * The menu's numbers (job sidebar v2; C1's contract docs/contracts/nav-counts.md), shared by the side menu, the phone bar and the More sheet: ONE poll per workspace however many parts draw them. The first ask is made
 * after the page is drawn (never before first paint), then at most every 30 seconds while the tab is in front, and again when the tab comes back to the front (if the last answer is 30 seconds old). A failed ask keeps
 * the last numbers; before any answer every number is null, so the menu draws no badge (never a made-up one).
 */
export const POLL_MS = 30_000;

type Entry = { counts: NavCounts; at: number; busy: boolean; users: number; timer: ReturnType<typeof setInterval> | null; listeners: Set<() => void> };
const entries = new Map<string, Entry>();

function entryOf(tenantId: string): Entry {
  let e = entries.get(tenantId);
  if (!e) {
    e = { counts: NO_COUNTS, at: 0, busy: false, users: 0, timer: null, listeners: new Set() };
    entries.set(tenantId, e);
  }
  return e;
}

async function ask(tenantId: string, force = false): Promise<void> {
  const e = entryOf(tenantId);
  if (e.busy || (!force && Date.now() - e.at < POLL_MS)) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  e.busy = true;
  try {
    const r = await fetch(`/app/tenants/${tenantId}/nav-counts`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (r.ok) {
      const body = (await r.json()) as { counts?: NavCounts };
      if (body && typeof body === "object" && body.counts && typeof body.counts === "object") {
        e.counts = { ...NO_COUNTS, ...body.counts };
        e.at = Date.now();
        e.listeners.forEach((l) => l());
      }
    }
  } catch {
    // the last numbers stay: a menu badge is a convenience
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
