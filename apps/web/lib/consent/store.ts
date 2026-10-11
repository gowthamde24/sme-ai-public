"use client";

import * as React from "react";

import { cookieFrom, CONSENT_COOKIE, NOT_ASKED, readConsent, serializeConsent, type Consent } from "./consent";

/**
 * The browser's copy of the cookie choice (job BH): the notice, the settings panel and the footer link share it through useSyncExternalStore. The choice is remembered in the `sme_consent`
 * cookie; if the browser will not store it, the choice lasts until the page is closed (so the notice can still be dismissed and the switch still moves).
 */
type State = { consent: Consent; settingsOpen: boolean };

let state: State | null = null; // null until first read in the browser
let kept: Consent | null = null; // the choice made on this page, when the cookie cannot be written
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function read(): Consent {
  try {
    const stored = readConsent(cookieFrom(document.cookie, CONSENT_COOKIE));
    if (stored.decided) return stored;
  } catch {
    // cookies are blocked
  }
  return kept ?? NOT_ASKED;
}

function current(initial: Consent): State {
  state ??= { consent: initial.decided ? initial : read(), settingsOpen: false };
  return state;
}

export function saveConsent(analytics: boolean): void {
  const consent: Consent = { decided: true, analytics };
  kept = consent;
  try {
    document.cookie = serializeConsent(analytics, window.location.protocol === "https:");
  } catch {
    // cookies are blocked: the choice lasts for this page
  }
  state = { consent, settingsOpen: false };
  emit();
}

let opener: Element | null = null; // the control that opened the settings: focus goes back to it when they close
/** The control that opened the settings panel (null if none). */
export const settingsOpener = (): Element | null => opener;

export function openCookieSettings(): void {
  opener = typeof document === "undefined" ? null : document.activeElement;
  state = { consent: (state ?? { consent: read(), settingsOpen: false }).consent, settingsOpen: true };
  emit();
}
export function closeCookieSettings(): void {
  if (!state) return;
  state = { ...state, settingsOpen: false };
  emit();
}

/** For tests: forget everything. */
export function resetConsentStore(): void {
  state = null;
  kept = null;
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The shared state. `initial` is what the server read from the cookie (so the first render matches the server's). */
export function useConsentState(initial: Consent): State {
  const server = React.useMemo<State>(() => ({ consent: initial, settingsOpen: false }), [initial.decided, initial.analytics]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useSyncExternalStore(subscribe, () => current(initial), () => server);
}
