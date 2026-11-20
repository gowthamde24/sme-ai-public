// the page's only scenes that start by themselves (the phone demo; the Lead Finder's sweep is a canvas of its own) start after the visitor's first scroll, so a picture of the page taken at load shows everything whole
let moved = false;
if (typeof window !== "undefined") window.addEventListener("scroll", () => void (moved = true), { once: true, passive: true });

/** Runs `fn` after the visitor's first scroll (at once if they have scrolled already); returns the way to cancel. */
export function afterFirstScroll(fn: () => void): () => void {
  if (moved) {
    fn();
    return () => undefined;
  }
  window.addEventListener("scroll", fn, { once: true, passive: true });
  return () => window.removeEventListener("scroll", fn);
}
