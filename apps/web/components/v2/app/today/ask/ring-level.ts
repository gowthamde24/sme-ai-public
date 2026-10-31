"use client";

import { useEffect, useState } from "react";

/** How loud the sound is, in four steps (0 = quiet): what the ring around the assistant's orb pulses with. Read from the browser's analyser (the microphone while it listens, the voice while it speaks) about 60 times a second, but the screen is redrawn only when the step changes. */
export type RingLevel = 0 | 1 | 2 | 3;

export function useRingLevel(analyser: AnalyserNode | null): RingLevel {
  const [level, setLevel] = useState<RingLevel>(0);
  useEffect(() => {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let last: RingLevel = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const d = (v - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / buf.length);
      const next: RingLevel = rms > 0.12 ? 3 : rms > 0.06 ? 2 : rms > 0.02 ? 1 : 0;
      if (next !== last) {
        last = next;
        setLevel(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  return analyser ? level : 0;
}
