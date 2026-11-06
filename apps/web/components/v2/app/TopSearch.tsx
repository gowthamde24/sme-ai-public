"use client";

import * as React from "react";

import { SpriteIcon } from "./icons";
import { ASK_EVENT } from "./today/ask/ask-event";

const GLASS = ["v2-glass", "border-line"];
const SOLID = ["bg-bg", "border-transparent"];

/**
 * The top bar's sidebar-v2 extras, as a chunk of its own (the route-JS budget counts the frame on every page): "Search or ask anything ⌘K" on a desktop, which asks the floating Ask like the keys do, and the
 * frosted bar once the page scrolls under it (`.v2-glass`, with its solid fallback). The bar is solid until this has loaded, and stays solid at the top of the page.
 */
export function TopSearch({ label }: { label: string }) {
  const box = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const bar = box.current?.closest("header");
    if (!bar) return;
    const look = () => {
      const on = window.scrollY > 4;
      bar.dataset.scrolled = on ? "true" : "false";
      for (const c of GLASS) bar.classList.toggle(c, on);
      for (const c of SOLID) bar.classList.toggle(c, !on);
    };
    look();
    window.addEventListener("scroll", look, { passive: true });
    return () => window.removeEventListener("scroll", look);
  }, []);
  return (
    <button ref={box} type="button" data-top="search" onClick={() => window.dispatchEvent(new Event(ASK_EVENT))} className="hidden min-h-11 w-full max-w-md items-center gap-2 rounded-xl border border-edge bg-surface px-3 text-left text-base text-muted hover:border-brand-edge md:inline-flex">
      <SpriteIcon id="search" className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <kbd className="shrink-0 rounded-md border border-line bg-surface-2 px-1.5 font-sans text-xs text-muted">⌘K</kbd>
    </button>
  );
}
