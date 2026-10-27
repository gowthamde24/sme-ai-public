import * as React from "react";

/**
 * The sound the assistant's circle follows (night 5): while the microphone is on, the analyser of the microphone; while an answer is spoken, the analyser of the audio that is playing; otherwise none (the circle moves on its own).
 * One holder for the whole page, because there is one microphone and one voice at a time. The recorder and the answer player put theirs here (audio-source.ts) and take it away when they stop; the circles only read it (`useAnalyser`). This file is
 * in every screen, so it is as small as it can be. A browser without Web Audio, or one that refuses it, simply leaves the circle with its own motion.
 */
let current: AnalyserNode | null = null;
const listeners = new Set<() => void>();

export const getAnalyser = (): AnalyserNode | null => current;
export function setAnalyser(next: AnalyserNode | null): void {
  current = next;
  listeners.forEach((f) => f());
}
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
/** The analyser of the sound that is going on now, or null (nothing is ever set on the server). */
export const useAnalyser = (): AnalyserNode | null => React.useSyncExternalStore(subscribe, getAnalyser, getAnalyser);
