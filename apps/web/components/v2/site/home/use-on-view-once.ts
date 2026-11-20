"use client";

import * as React from "react";

/**
 * "final": the page as the server drew it (no JavaScript, "reduce motion", no IntersectionObserver): everything in its END state, nothing moves.
 * "ready": the browser took over and the block is below the fold: its small scene waits in its START state (opacity and transform only: nothing changes size, so nothing shifts).
 * "played": the block was 40% in view once: the scene runs ONCE (CSS transitions keyed on the phase) and never again.
 */
export type Phase = "final" | "ready" | "played";

const none = () => () => undefined;
const motionOk = (): boolean => typeof IntersectionObserver !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true;

/**
 * The home page's ONE hook for "play this tiny live moment once when it scrolls into view" (job home v4). Returns `[ref, phase]`: put `ref` on the block and `data-phase={phase}` on the same element; the CSS of the moment reads `[data-phase="ready"]` (start) and
 * `[data-phase="played"]` (run to the end). The server renders "final", so a visitor without JavaScript, or with "reduce motion", sees every moment finished at once.
 */
export function useOnViewOnce<T extends Element>(threshold = 0.4): readonly [React.RefObject<T | null>, Phase] {
  const ref = React.useRef<T>(null);
  const can = React.useSyncExternalStore(none, motionOk, () => false);
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !can || seen) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [can, seen, threshold]);
  return [ref, !can ? "final" : seen ? "played" : "ready"] as const;
}
