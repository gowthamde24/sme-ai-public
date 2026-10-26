"use client";

import * as React from "react";

import type { AskSession } from "./use-ask-session";

/**
 * Where the workspace's one conversation is handed from the code that runs it to the screens that draw it (job DQ part 0). The session itself (the question, the streaming answer, the microphone, the spoken answer) is a lot of code, and the
 * layout is on every page of the workspace, so it is a chunk of its own (AskSessionHost) that loads after the page and publishes the session here; the views (Today's card, the floating orb's panel) read it from here and draw nothing
 * live until it arrives. This file is the only part of the machinery on every page: a variable and a list of listeners.
 */
let current: AskSession | null = null;
const listeners = new Set<() => void>();

export function publishSession(session: AskSession | null): void {
  current = session;
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The workspace's conversation, or null until its code has arrived (and in a page with no provider). */
export function useStoredAsk(): AskSession | null {
  return React.useSyncExternalStore(subscribe, () => current, () => null);
}

/** True inside an AskProvider: a card that finds no session yet then waits for it (a card outside a provider makes its own). */
export const AskProvidedContext = React.createContext(false);
