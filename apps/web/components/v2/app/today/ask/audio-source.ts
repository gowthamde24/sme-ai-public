import { getAnalyser, setAnalyser } from "./audio-level";

/** Takes the analyser away, but only if it is still the one that was put (a newer sound may have taken its place). */
export function clearAnalyser(mine: AnalyserNode | null): void {
  if (mine !== null && getAnalyser() === mine) setAnalyser(null);
}

/** Making an analyser (Web Audio), for the recorder and the answer player. A file of its own: the circles in every screen only READ the analyser (audio-level.ts), and this code loads with the microphone and the player. */
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
