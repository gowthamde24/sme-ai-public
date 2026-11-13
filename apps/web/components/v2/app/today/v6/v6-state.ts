"use client";

import * as React from "react";

/**
 * Where Today's "Talk live" is on or off (design system v6). One small variable and its listeners, like ask-store.ts: the orb of the command bar (a desktop) or of the phone's headline and the phone's "Hold to speak" bar turn the SAME bar into the live
 * conversation, and End (or Type) turns it back. Kept outside React so the two ends of the phone (the orb at the top, the bar at the bottom) share it without a provider around the whole page.
 */
let talking = false;
const listeners = new Set<() => void>();

export function setTalking(on: boolean): void {
  if (talking === on) return;
  talking = on;
  for (const l of [...listeners]) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export function useTalking(): boolean {
  return React.useSyncExternalStore(subscribe, () => talking, () => false);
}

/** What the live conversation is doing (listening, thinking, speaking), published by the live bar so the orb OUTSIDE the composer animates with it; null = no conversation. */
export type TalkMood = "listening" | "thinking" | "speaking" | null;
let mood: TalkMood = null;
const moodListeners = new Set<() => void>();
export function setTalkMood(next: TalkMood): void {
  if (mood === next) return;
  mood = next;
  for (const l of [...moodListeners]) l();
}
const subscribeMood = (l: () => void) => {
  moodListeners.add(l);
  return () => {
    moodListeners.delete(l);
  };
};
export function useTalkMood(): TalkMood {
  return React.useSyncExternalStore(subscribeMood, () => mood, () => null);
}

/** The loudness source of the live conversation (the microphone while it listens, the voice while it speaks), published by the live bar so the orb OUTSIDE the composer moves with the sound; null = none (the orb then breathes by itself). */
let analyser: AnalyserNode | null = null;
const analyserListeners = new Set<() => void>();
export function setTalkAnalyser(next: AnalyserNode | null): void {
  if (analyser === next) return;
  analyser = next;
  for (const l of [...analyserListeners]) l();
}
const subscribeAnalyser = (l: () => void) => {
  analyserListeners.add(l);
  return () => {
    analyserListeners.delete(l);
  };
};
export function useTalkAnalyser(): AnalyserNode | null {
  return React.useSyncExternalStore(subscribeAnalyser, () => analyser, () => null);
}

/** A tap on the orb while the assistant speaks cuts it off (barge-in) instead of closing the conversation; the live bar registers what that does (null = nothing to cut). */
let barge: (() => void) | null = null;
export const setTalkBarge = (fn: (() => void) | null): void => {
  barge = fn;
};
export const getTalkBarge = (): (() => void) | null => barge;
/** The current mood, read at the moment of a tap (not during a render). */
export const getTalkMood = (): TalkMood => mood;

const mq = "(min-width: 768px)";
const subscribeWidth = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const q = window.matchMedia(mq);
  q.addEventListener("change", notify);
  return () => q.removeEventListener("change", notify);
};
/** A desktop (768 px and wider)? Only one of the two bands (desktop, phone) mounts the live conversation, so there is never a second timer. No matchMedia (a test): a desktop. The server draws the desktop. */
export function useIsDesktop(): boolean {
  return React.useSyncExternalStore(subscribeWidth, () => typeof window.matchMedia !== "function" || window.matchMedia(mq).matches, () => true);
}
