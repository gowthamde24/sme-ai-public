"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A small pop-over built on <details>: it works without script, and with it the menu closes when the person goes to another page, presses
 * Escape, or taps outside. `summary` is the button; `children` the panel. Used for the workspace switcher and the account menu.
 */
export function Disclosure({ summary, children, summaryClassName, panelClassName, label }: { summary: ReactNode; children: ReactNode; summaryClassName: string; panelClassName: string; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") {
          el.removeAttribute("open");
          el.querySelector("summary")?.focus();
        }
      } else if (e.target instanceof Node && !el.contains(e.target)) el.removeAttribute("open");
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, []);
  return (
    <details ref={ref} className="relative" aria-label={label}>
      <summary className={`${summaryClassName} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{summary}</summary>
      <div className={panelClassName}>{children}</div>
    </details>
  );
}
