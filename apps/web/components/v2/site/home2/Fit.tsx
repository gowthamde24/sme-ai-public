"use client";

import * as React from "react";

/**
 * ONE drawing at every width (owner, 20 Nov 2026: "the desktop animations run on phones too, scaled; no separate phone version"): the children are laid out at their design size (the CSS class gives the width and height,
 * e.g. the hero stage's 1240 x 540) and this box scales them down to the width it is given, in one step (a CSS transform on a box of the design size, so every canvas keeps its own resolution and nothing is
 * redrawn differently). The scale is measured here and set as a custom property; until it is known the drawing is not shown (it would be 1240 px wide). Server markup has everything; the scene itself is a client island.
 */
export function Fit({ className, children }: { className: string; children: React.ReactNode }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const apply = () => {
      const inner = el.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const design = inner.offsetWidth;
      if (design > 0) el.style.setProperty("--fit", String(Math.min(1, el.clientWidth / design)));
      setReady(true);
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={`h3-fit ${className}`} data-ready={ready ? "" : undefined}>
      <div className="h3-fit-in">{children}</div>
    </div>
  );
}
