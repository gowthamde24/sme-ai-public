"use client";

import * as React from "react";

/**
 * Keeps the Agent OWL's answer in view while it streams (job DH). On a phone the answer area sits below the fold, behind the bar that holds the question box and the tab bar, so a person watched the owl say "Answering"
 * and saw no word arrive until they scrolled; on a laptop the first line of a longer answer began at the bottom edge. The rule is the smallest scroll that shows the newest words: the bottom of the answer area
 * is lifted above whatever is fixed at the foot of the screen (the question bar and the tab bar on a phone), but never so far that the "You asked" line leaves the top of the screen. When the person scrolls themselves
 * (wheel, touch, or a key that goes up) the page stops following until the next question. Reduced motion jumps instead of gliding.
 */
export const TOP_GAP = 88; // the header is about 64 px tall
export const BOTTOM_ON_PHONE = 168; // the question bar (about 88 px) and the tab bar (about 72 px)
export const BOTTOM_ON_LAPTOP = 24;
const PHONE_WIDTH = 768; // Tailwind's md

/** How many pixels to scroll down so the answer area's bottom is above the fixed foot, without pushing its top above TOP_GAP. 0 when nothing needs to move. Pure, so it is tested without a browser. */
export function followDelta(rect: { top: number; bottom: number }, viewportHeight: number, viewportWidth: number): number {
  const reserve = viewportWidth < PHONE_WIDTH ? BOTTOM_ON_PHONE : BOTTOM_ON_LAPTOP;
  const overflow = rect.bottom - (viewportHeight - reserve);
  if (overflow <= 0) return 0;
  return Math.max(0, Math.min(overflow, rect.top - TOP_GAP));
}

/** The element that scrolls for `el`: the nearest ancestor that scrolls by itself, else the window. */
function scroller(el: HTMLElement): HTMLElement | Window {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return window;
}

function follow(el: HTMLElement | null): void {
  if (!el) return;
  const delta = followDelta(el.getBoundingClientRect(), window.innerHeight, window.innerWidth);
  if (delta <= 0) return;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scroller(el).scrollBy({ top: delta, behavior: reduced ? "auto" : "smooth" });
}

/** `run` counts the questions (a new one starts following again); `asking` is true until the answer is whole; `growth` changes whenever the area grows (the text, a source, a draft). */
export function useFollowAnswer(run: number, asking: boolean, growth: string): React.RefObject<HTMLDivElement | null> {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const following = React.useRef(true);
  React.useEffect(() => {
    following.current = true;
  }, [run]);
  React.useEffect(() => {
    if (!asking) return;
    const stop = () => {
      following.current = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") stop();
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", key);
    };
  }, [asking, run]);
  React.useEffect(() => {
    if (asking && following.current) follow(ref.current);
  }, [asking, run, growth]);
  return ref;
}
