"use client";

import { useSyncExternalStore } from "react";

/**
 * The offline queue (app v4 part 9, owner 9 Nov 2026): while there is no network, a tap on a SAFE action (skip, "Not now", mark as handled) waits here and is done when the connection comes back; the "Waiting for network" chip shows how many wait.
 * A MONEY or SENDING action (approve, send, call, pay, edit a message) is never queued, not even silently: the person is told to ask again when they are back online (see `OFFLINE_REFUSED`). The queue lives in this tab's memory only: nothing
 * is written to storage, so a closed tab forgets it (an old tap is never replayed hours later), and each item is done once, in order.
 */
type Item = { id: string; run: () => Promise<void> };
const items: Item[] = [];
const listeners = new Set<() => void>();
let count = 0;
const emit = () => {
  count = items.length;
  listeners.forEach((l) => l());
};
let flushing = false;
async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  while (items.length > 0 && navigator.onLine) {
    const item = items[0];
    try {
      await item.run();
    } catch {
      // the action says its own failure; it is not asked again
    }
    items.shift();
    emit();
  }
  flushing = false;
}
if (typeof window !== "undefined") window.addEventListener("online", () => void flush());

/** Waits for the network, once per id (a second tap on the same thing is the same wait). */
export function queueSafe(id: string, run: () => Promise<void>): void {
  if (items.some((i) => i.id === id)) return;
  items.push({ id, run });
  emit();
}
export const queued = (): number => count;
export function useQueued(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count,
    () => 0,
  );
}
/** For tests: forget everything waiting. */
export function clearQueue(): void {
  items.length = 0;
  emit();
}
