import * as React from "react";

/**
 * The sound the assistant's circle follows (night 5): while the microphone is on, the analyser of the microphone; while an answer is spoken, the analyser of the audio that is playing; otherwise none (the circle moves on its own).
 * One holder for the whole page, because there is one microphone and one voice at a time. The recorder and the answer player put theirs here and take it away when they stop; the circles read it (`useAnalyser`).
 * Everything is optional: a browser without Web Audio, or one that refuses it, simply leaves the circle with its own motion.
 */
let current: AnalyserNode | null = null;
const listeners = new Set<() => void>();

export function setAnalyser(next: AnalyserNode | null): void {
  if (current === next) return;
  current = next;
  listeners.forEach((f) => f());
}
/** Takes the analyser away, but only if it is still the one that was put (a newer sound may have taken its place). */
export function clearAnalyser(mine: AnalyserNode | null): void {
  if (mine !== null && current === mine) setAnalyser(null);
}
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
/** The analyser of the sound that is going on now, or null. */
export const useAnalyser = (): AnalyserNode | null => React.useSyncExternalStore(subscribe, () => current, () => null);

type AudioWindow = { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
/** A Web Audio context, if this browser has one (Safari's older name too); null otherwise. */
export function makeContext(): AudioContext | null {
  try {
    const w = (typeof window === "undefined" ? {} : window) as AudioWindow;
    const C = w.AudioContext ?? w.webkitAudioContext;
    return C ? new C() : null;
  } catch {
    return null;
  }
}
/** An analyser fed by `source`, small and smooth (the circle only needs loudness). Not connected to the speakers: for the microphone that would make an echo. */
export function analyserOf(ctx: AudioContext, source: AudioNode): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  return analyser;
}
