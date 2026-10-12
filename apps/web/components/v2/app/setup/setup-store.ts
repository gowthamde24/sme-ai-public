"use client";

import { NEW_LOCAL, type Local } from "./setup-logic";

/**
 * This device's memory of one workspace's setup (job BJ): in localStorage (try/catch), shared by the wizard, the checklist and the gate through useSyncExternalStore, and kept in memory when the browser will
 * not store it. The API holds no setup state yet, so "skipped" and "hidden" are per device (the report lists the API that would sync them); what is done is read from the API's real data every time.
 */
const KEY = (tenantId: string) => `sme.setup.v1.${tenantId}`;
const cache = new Map<string, Local>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

const STATES = ["new", "skipped", "done", "dismissed"] as const;
function parse(raw: string | null): Local {
  if (!raw) return NEW_LOCAL;
  try {
    const v = JSON.parse(raw) as Partial<Local>;
    return {
      state: (STATES as readonly unknown[]).includes(v.state) ? (v.state as Local["state"]) : "new",
      step: typeof v.step === "number" && Number.isInteger(v.step) && v.step >= 0 && v.step <= 4 ? v.step : 0,
      agentSeen: v.agentSeen === true,
      hoursDone: v.hoursDone === true,
      sareeDone: v.sareeDone === true,
    };
  } catch {
    return NEW_LOCAL;
  }
}

/** The stored state of a workspace (the same object until it changes). */
export function readLocal(tenantId: string): Local {
  const known = cache.get(tenantId);
  if (known) return known;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY(tenantId));
  } catch {
    // storage is blocked: the memory below holds it for this page
  }
  const local = parse(raw);
  cache.set(tenantId, local);
  return local;
}

export function writeLocal(tenantId: string, patch: Partial<Local>): Local {
  const next = { ...readLocal(tenantId), ...patch };
  cache.set(tenantId, next);
  try {
    window.localStorage.setItem(KEY(tenantId), JSON.stringify(next));
  } catch {
    // blocked: kept in memory until the page closes
  }
  emit();
  return next;
}

export function subscribeLocal(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith("sme.setup.v1.")) {
      cache.delete(e.key.slice("sme.setup.v1.".length)); // another tab changed it: read it again
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** For tests. */
export function resetSetupStore(): void {
  cache.clear();
  emit();
}
