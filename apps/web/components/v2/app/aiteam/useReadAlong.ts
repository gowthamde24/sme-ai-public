"use client";

import * as React from "react";

/** How long reading a stand-up of this many letters takes when it is stepped through without sound: about 18 letters a second, never under 4 seconds. */
export const readMs = (letters: number): number => Math.max(4000, Math.round(letters * 55));

/**
 * "Read the stand-up" (owner, 9 Nov 2026: no audio, the voice stays off): the stand-up's own words are stepped through at reading speed, the way the sound used to drive them: `fraction` (0 to 1) says where it is, so the step bar and the
 * word being read follow it. Pause keeps the place; at the end it goes back to the start. Nothing is fetched, heard or stored.
 */
export function useReadAlong(letters: number) {
  const [playing, setPlaying] = React.useState(false);
  const [fraction, setFraction] = React.useState(0);
  const total = readMs(letters);
  const from = React.useRef(0);
  React.useEffect(() => {
    if (!playing) return;
    from.current = Date.now() - fraction * total;
    const id = setInterval(() => {
      const f = (Date.now() - from.current) / total;
      if (f >= 1) {
        setPlaying(false);
        setFraction(0);
      } else setFraction(f);
    }, 100);
    return () => clearInterval(id);
    // (the place is read once, when it starts; the timer then keeps it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);
  return {
    playing,
    fraction,
    toggle: () => setPlaying((p) => !p),
    reset: () => {
      setPlaying(false);
      setFraction(0);
    },
  };
}
