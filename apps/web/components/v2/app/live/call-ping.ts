"use client";

import * as React from "react";

import type { LiveCall } from "@/lib/live-calls/model";

/**
 * The "a call started" notification (app v4, owner 9 Nov 2026), on THIS device only (a switch in Settings > Notifications, remembered in the browser's own storage; nothing about it is sent anywhere):
 *   sme-notify-calls        "on" | "off" | (nothing = not asked yet)
 *   sme-notify-calls-seen   the ids of the calls already announced, so two tabs say it once
 * It is a real browser notification, shown through the service worker so that it can carry the two buttons ("Read along", "Take over"). It says who (a real name only; a caller with no name is "a new caller"), never a phone
 * number, and where they came from. It is shown while the app is open in some tab (a tab behind others keeps asking, slowly, while the switch is on): a notification from a closed app needs the server to push it (Web Push),
 * which the API does not do yet.
 */
export const PING_KEY = "sme-notify-calls";
const SEEN_KEY = "sme-notify-calls-seen";
const listeners = new Set<() => void>();
const read = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null): void => {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    // blocked storage: this visit works, it just cannot remember
  }
  listeners.forEach((l) => l());
};
export const pingSetting = (): "on" | "off" | null => {
  const v = read(PING_KEY);
  return v === "on" || v === "off" ? v : null;
};
export const setPing = (on: boolean): void => write(PING_KEY, on ? "on" : "off");
/** Whether a background tab should keep asking for live calls (only while the person has the notification on and the browser allows it). */
export const pingWanted = (): boolean => typeof Notification !== "undefined" && Notification.permission === "granted" && pingSetting() === "on";
export const pingPermission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

/** Asks the browser (only ever from a tap) and turns the switch on when it was allowed. */
export async function askPing(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  setPing(result === "granted");
  return result;
}

const seenIds = (): string[] => {
  try {
    const v = JSON.parse(read(SEEN_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-30) : [];
  } catch {
    return [];
  }
};
/** Remembers this call as announced and says whether it was new (another tab may have said it first). */
function claim(id: string): boolean {
  const seen = seenIds();
  if (seen.includes(id)) return false;
  write(SEEN_KEY, JSON.stringify([...seen, id].slice(-30)));
  return true;
}

export type PingWords = { title: string; body: (c: LiveCall) => string; read: string; take: string };

/** Says each NEW live call once: a call that was already running when the page opened is not new (only one answered in the first seconds of its life is). */
export function useCallPing(calls: readonly LiveCall[], at: number, base: string, words: PingWords): void {
  const first = React.useRef(true);
  const ref = React.useRef(words);
  React.useEffect(() => {
    ref.current = words;
  });
  React.useEffect(() => {
    if (at === 0) return;
    const wasFirst = first.current;
    first.current = false;
    if (!pingWanted()) {
      // still remembered, so turning the switch on later does not announce calls that began before
      calls.forEach((c) => claim(c.id));
      return;
    }
    for (const c of calls) {
      if (wasFirst && c.elapsedS > 20) {
        claim(c.id);
        continue;
      }
      if (!claim(c.id)) continue;
      void show(c, base, ref.current);
    }
  }, [calls, at, base]);
}

async function show(c: LiveCall, base: string, w: PingWords): Promise<void> {
  const url = `${base}/calls/${c.id}`;
  const options = { body: w.body(c), tag: `sme-call-${c.id}`, data: { url }, icon: "/icons/icon-192.png", ...(c.canTakeOver ? { actions: [{ action: "read", title: w.read }, { action: "takeover", title: w.take }] } : { actions: [{ action: "read", title: w.read }] }) } as NotificationOptions;
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(w.title, options);
      return;
    }
  } catch {
    // some phones refuse: the plain notification below
  }
  try {
    const n = new Notification(w.title, { body: options.body, tag: options.tag });
    n.onclick = () => {
      window.focus();
      window.location.href = url;
    };
  } catch {
    // the bar itself still shows the call
  }
}

/** A change of the switch (this tab or another) re-draws what shows it. */
export function subscribePing(l: () => void): () => void {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}
