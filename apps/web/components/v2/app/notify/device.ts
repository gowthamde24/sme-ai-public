"use client";

import { parseSeen } from "@/lib/notifications/model";

/**
 * What the bell remembers on THIS device (job BU), in the browser's own storage; nothing is sent anywhere and nothing is shared with another browser. Every read and write is guarded: a private window or blocked
 * storage just means the bell starts with everything unread and cannot remember that you turned browser notifications on.
 *   sme-notify-seen:<workspace>       the ids of the notices already shown to you (so "new" is per device)
 *   sme-notify-announced:<workspace>  the ids a browser notification already told you about
 *   sme-notify-browser                "on" when you turned browser notifications on (you must also allow them in the browser)
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export function subscribeDevice(l: () => void): () => void {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage is blocked: this visit still works, it just cannot remember
  }
  notify();
};

export const seenKey = (tenantId: string) => `sme-notify-seen:${tenantId}`;
export const announcedKey = (tenantId: string) => `sme-notify-announced:${tenantId}`;
export const BROWSER_KEY = "sme-notify-browser";

/** The raw string (a primitive, so useSyncExternalStore can compare it); `null` = nothing stored. */
export const seenRaw = (tenantId: string): string | null => read(seenKey(tenantId));
export const seenIds = (tenantId: string): string[] => parseSeen(read(seenKey(tenantId)));
export const writeSeen = (tenantId: string, ids: readonly string[]): void => write(seenKey(tenantId), JSON.stringify(ids));
export const announcedIds = (tenantId: string): string[] => parseSeen(read(announcedKey(tenantId)));
export const writeAnnounced = (tenantId: string, ids: readonly string[]): void => write(announcedKey(tenantId), JSON.stringify(ids));
export const browserOptInRaw = (): string | null => read(BROWSER_KEY);
export const setBrowserOptIn = (on: boolean): void => write(BROWSER_KEY, on ? "on" : null);
