"use client";

import type { VoiceLang } from "@/lib/browser-voice/protocol";

/**
 * Which language voice typing listens for, on THIS device (owner decision, 9 Nov 2026, voice input everywhere): the app's language until the person picks another on the small "Hearing: Telugu" chip, or "auto" (any language, for speech that
 * mixes languages and has no single one to pin). Kept in the browser's own storage (nothing is sent anywhere); a blocked store just means the app's language every time.
 */
export type HearLang = VoiceLang | "auto";
export const HEAR_CHOICES: readonly HearLang[] = ["te", "kn", "hi", "en", "auto"];
const KEY = "sme-voice-lang";
const listeners = new Set<() => void>();

const isChoice = (v: unknown): v is HearLang => (HEAR_CHOICES as readonly unknown[]).includes(v);
export function readHear(app: VoiceLang): HearLang {
  try {
    const v = window.localStorage.getItem(KEY);
    return isChoice(v) ? v : isChoice(app) ? app : "en";
  } catch {
    return isChoice(app) ? app : "en";
  }
}
export function nextHear(now: HearLang): HearLang {
  const i = HEAR_CHOICES.indexOf(now);
  return HEAR_CHOICES[(i + 1) % HEAR_CHOICES.length];
}
export function writeHear(v: HearLang): void {
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    // blocked storage: this visit works, it just cannot remember
  }
  listeners.forEach((l) => l());
}
export function subscribeHear(l: () => void): () => void {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

/** The first-time hint ("Your voice is turned into text and not saved.") is shown until it has been shown once on this device. */
const HINT_KEY = "sme-voice-hint";
export const hintSeen = (): boolean => {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true; // cannot remember: do not nag every time
  }
};
export const markHintSeen = (): void => {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // nothing to do
  }
  listeners.forEach((l) => l());
};
