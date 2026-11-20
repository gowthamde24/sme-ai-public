"use client";

import * as React from "react";

/**
 * "final": the page as the server drew it (no JavaScript, "reduce motion", no IntersectionObserver): everything in its END state, nothing moves.
 * "ready": the browser took over and the block is below the fold: its small scene waits in its START state (opacity and transform only: nothing changes size, so nothing shifts).
 * "played": the block was 40% in view once: the scene runs ONCE (CSS transitions keyed on the phase) and never again.
 */
export type Phase = "final" | "ready" | "played";


// a visitor who has not scrolled yet (and a capture of the whole page that never scrolls) sees every moment FINISHED: the scenes start only after the first scroll, so a picture of the page taken at load is never a half-played frame or an empty start state
let moved = false;
if (typeof window !== "undefined") window.addEventListener("scroll", () => void (moved = true), { once: true, passive: true });
/** Runs `fn` after the visitor's first scroll (at once if they have scrolled already); returns the way to cancel. The demo's clock and the footer wordmark start with it, so a picture taken at load shows them whole. */
export function afterFirstScroll(fn: () => void): () => void {
  if (moved) {
    fn();
    return () => undefined;
  }
  window.addEventListener("scroll", fn, { once: true, passive: true });
  return () => window.removeEventListener("scroll", fn);
}
const subscribe = (cb: () => void) => {
  window.addEventListener("scroll", cb, { once: true, passive: true });
  return () => window.removeEventListener("scroll", cb);
};
const canPlay = (): boolean => moved && typeof IntersectionObserver !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches !== true;

/**
 * The home page's ONE hook for "play this tiny live moment once when it scrolls into view" (job home v4). Returns `[ref, phase]`: put `ref` on the block and `data-phase={phase}` on the same element; the CSS of the moment reads `[data-phase="ready"]` (start) and
 * `[data-phase="played"]` (run to the end). The server renders "final", so a visitor without JavaScript, or with "reduce motion", sees every moment finished at once; so does a visitor who has not scrolled yet (the scenes start after the first scroll).
 */
export function useOnViewOnce<T extends Element>(threshold = 0.4): readonly [React.RefObject<T | null>, Phase] {
  const ref = React.useRef<T>(null);
  const can = React.useSyncExternalStore(subscribe, canPlay, () => false);
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
