"use client";

import * as React from "react";

/**
 * Keeps a fixed bottom panel above the on-screen keyboard (iOS Safari does not resize the page for it; Android Chrome only the visual viewport). It writes two CSS variables on the element, `--kb` (how far the keyboard covers the bottom of the page, px) and `--vvh` (the height left for
 * the page, px), which the panel's classes read (`bottom-[var(--kb,0px)]`, `max-h-[calc(var(--vvh,100dvh)-0.5rem)]`); without a visual viewport they are not set and nothing changes. `onChange` runs after every change (the chat scrolls its last message into view).
 */
export function useKeyboardInset(target: React.RefObject<HTMLElement | null>, enabled: boolean, onChange?: () => void): void {
  const again = React.useRef(onChange);
  React.useEffect(() => {
    again.current = onChange;
  });
  React.useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    const el = target.current;
    if (!enabled || !vv || !el) return;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
      el.style.setProperty("--kb", `${covered}px`);
      el.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      again.current?.();
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      el.style.removeProperty("--kb");
      el.style.removeProperty("--vvh");
    };
  }, [target, enabled]);
}
