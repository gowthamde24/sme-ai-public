"use client";

import * as React from "react";

/**
 * When the ask and voice machinery starts (perf fix b, 19 Nov 2026). Today used to start it all at load: the voice-availability check (`ask/voice`), the earlier conversation (`conversation` twice, then the links its messages carry), the voice sign-in (`voice-token`) and the
 * chunk of the chat thread, although none of it is seen until the person uses the composer or the orb. Now it starts on the FIRST use (a press, a focus or a key in the composer, a tap on the orb, the floating orb or the top bar's ask) through `wakeAsk()`, or
 * when the browser is idle, `IDLE_WAKE_MS` after the page is up (`armIdleWake`), so a person who only reads finds it ready a little later without having slowed the first screen. One variable and its listeners, like ask-store.ts; it stays awake for the rest of the visit.
 */
export const IDLE_WAKE_MS = 4000;

let awake = false;
const listeners = new Set<() => void>();
const starters = new Set<() => void>();

/** Something that must start the very moment of the wake, in the same call (not after the next render): the earlier conversation's read, so a first message sent in that moment can wait for it. Returns the way to take it back. */
export function onWake(start: () => void): () => void {
  starters.add(start);
  return () => {
    starters.delete(start);
  };
}

/** Start it now (the first press, focus or key of the composer or the orb). Calling it again does nothing. */
export function wakeAsk(): void {
  if (awake) return;
  awake = true;
  for (const f of [...starters]) f();
  for (const l of [...listeners]) l();
}

export function isAskAwake(): boolean {
  return awake;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** True once the machinery has been started (never during the first moments of a page that nobody has touched). */
export function useAskAwake(): boolean {
  return React.useSyncExternalStore(subscribe, () => awake, () => false);
}

/** Wakes it `delay` ms from now (never sooner) when the browser is idle (`requestIdleCallback`, else a timer). Returns the way to cancel (the layout goes away). */
export function armIdleWake(delay: number = IDLE_WAKE_MS): () => void {
  if (awake) return () => undefined;
  let idle: number | null = null;
  const timer = setTimeout(() => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => wakeAsk(), { timeout: 2000 });
    else wakeAsk();
  }, delay);
  return () => {
    clearTimeout(timer);
    if (idle !== null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
  };
}

/** Tests only: back to asleep. */
export function resetAskWake(): void {
  awake = false;
}
