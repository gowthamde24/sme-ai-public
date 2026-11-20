"use client";

import * as React from "react";

/**
 * A live moment that plays ONCE when its block scrolls into view (owner, 21 Nov 2026: "theirs is dynamic"). Returns a ref for the block and `seen`, false until the block is at least `amount` (default 35 %) in view, then true for good (the
 * observer is dropped, nothing runs after that). Where the browser has no IntersectionObserver it is true at once. The block decides what to do with a reduced-motion setting (the final state at once); this hook only says "now".
 * Shared by the home page's blocks (try-it, the lower sections): one hook, not one per block.
 */
export function useOnViewOnce<T extends Element>(amount = 0.35): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T | null>(null);
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setSeen(true), 0);
      return () => window.clearTimeout(id);
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: amount },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [amount]);
  return [ref, seen];
}
