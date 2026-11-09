"use client";

/**
 * "Feel" (app v4 part 9, owner 9 Nov 2026): a short vibration and a soft tone when the assistant starts listening, finishes, and when something needs the owner. A switch under Settings > Notifications turns it off (on this device, in the
 * browser's own storage); where the browser cannot vibrate (an iPhone's browser) there is no switch and nothing happens. It only happens while the app is in front, never from a background tab, and the tone follows the phone's silent mode where the
 * browser lets a page say so (`navigator.audioSession` "ambient": the ringer switch mutes it). Nothing is recorded and nothing is sent anywhere.
 */
export type FeelKind = "listening" | "done" | "needs";
const KEY = "sme-feel";
const PATTERN: Record<FeelKind, number[]> = { listening: [18], done: [12, 40, 12], needs: [30, 60, 30] };
const TONE: Record<FeelKind, number> = { listening: 660, done: 880, needs: 520 };
const listeners = new Set<() => void>();

export const canFeel = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
const stored = (): string | null => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
/** On by default where it can work; the person turns it off in Settings. */
export const feelOn = (): boolean => canFeel() && stored() !== "off";
export function setFeel(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // blocked storage: this visit works, it just cannot remember
  }
  listeners.forEach((l) => l());
}
export function subscribeFeel(l: () => void): () => void {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

let ctx: AudioContext | null = null;
function tone(hz: number): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "ambient"; // follows the silent switch
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.frequency.value = hz;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch {
    // no sound: the vibration (or nothing) is all there is
  }
}

/** Does it, when it is on and the app is in front. */
export function feel(kind: FeelKind): void {
  if (!feelOn() || document.visibilityState !== "visible") return;
  navigator.vibrate(PATTERN[kind]);
  tone(TONE[kind]);
}
