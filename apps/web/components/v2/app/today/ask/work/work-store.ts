import * as React from "react";

import type { TestResult, WorkPlan } from "@/lib/assistant-work/types";

/**
 * What happened to a card after it was drawn (a plan that ran, a key that was saved, a live test's result), kept per chat and keyed by the card's id: an exchange moves from "on screen" into the
 * thread (a new element), and its card must not forget that it was done. NEVER a secret's value: only "saved" and at most the last four characters the API returned.
 */
export type CardState = { plan?: WorkPlan; secret?: { last4: string | null }; test?: TestResult; /** A "How it talks to you" card whose change was undone. */ talkUndone?: boolean };

export type WorkStore = {
  get(id: string): CardState | undefined;
  set(id: string, patch: CardState): void;
  subscribe(fn: () => void): () => void;
};

export function createWorkStore(): WorkStore {
  const map = new Map<string, CardState>();
  const subs = new Set<() => void>();
  return {
    get: (id) => map.get(id),
    set(id, patch) {
      map.set(id, { ...map.get(id), ...patch });
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

export function useCardState(store: WorkStore, id: string): CardState | undefined {
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.get(id),
    () => store.get(id),
  );
}
