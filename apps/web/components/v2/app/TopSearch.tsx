"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { FRAME_LOADING } from "./contract";
import { useFrameData } from "./frame-store";
import { SpriteIcon } from "./icons";
import type { Labels } from "./labels";
import { addRecent, parseRecent, type PaletteNames } from "./palette/palette";
import { useWorkspace, type Membership } from "./use-workspace";

const CommandPalette = dynamic(() => import("./palette/CommandPalette").then((m) => m.CommandPalette), { ssr: false });

const GLASS = ["v2-glass", "border-line"];
const SOLID = ["bg-bg", "border-transparent"];
/** What the palette needs from the server: the words of every item in every language of the app, and its own words in the person's (palette/names.ts). */
export type PaletteSetup = { names: PaletteNames; words: Readonly<Record<string, string>> };

/**
 * The top bar's search, as a chunk of its own (the route-JS budget counts the frame on every page): "Search or ask anything ⌘K" on a desktop and a search button on a phone open the command palette (owner, 6 Nov 2026: a real command
 * palette, never a jump to the assistant); so do ⌘K and Ctrl+K anywhere. It also keeps "Recent" (the pages opened, per person and workspace, in this browser) and makes the bar frosted once the page scrolls under it (`.v2-glass`, with its
 * solid fallback).
 */
export function TopSearch({ label, memberships, labels, palette, who }: { label: string; memberships: readonly Membership[]; labels?: Labels; palette: PaletteSetup; /** The signed-in person (their e-mail), so "Recent" is theirs. */ who: string }) {
  const box = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const { current } = useWorkspace(memberships);
  const frame = useFrameData(FRAME_LOADING);
  const pathname = usePathname() ?? "";
  const search = useSearchParams()?.toString() ?? "";
  const recentKey = `sme_recent:${who}:${current?.id ?? ""}`;

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
  // ⌘K / Ctrl+K opens (and closes) the palette anywhere in the workspace
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement as HTMLElement | null;
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // "Recent": the page just opened, by its H1 (every page has the menu's word or its own title as H1), a moment after it is drawn
  React.useEffect(() => {
    if (!current || !pathname.startsWith("/app/tenants/")) return;
    const id = window.setTimeout(() => {
      const h1 = document.querySelector("#main-content h1")?.textContent?.trim();
      if (!h1) return;
      try {
        const list = parseRecent(window.localStorage.getItem(recentKey));
        window.localStorage.setItem(recentKey, JSON.stringify(addRecent(list, { href: `${pathname}${search ? `?${search}` : ""}`, label: h1.slice(0, 80) })));
      } catch {
        // storage blocked: no Recent, nothing else changes
      }
    }, 800);
    return () => window.clearTimeout(id);
  }, [pathname, search, current, recentKey]);
  const show = (e: React.MouseEvent<HTMLButtonElement>) => {
    opener.current = e.currentTarget;
    setOpen(true);
  };
  const close = React.useCallback(() => {
    setOpen(false);
    window.setTimeout(() => opener.current?.focus?.(), 0);
  }, []);

  return (
    <div ref={box} className="contents">
      <button type="button" data-top="search" onClick={show} aria-haspopup="dialog" className="hidden min-h-11 w-full max-w-md items-center gap-2 rounded-xl border border-edge bg-surface px-3 text-left text-base text-muted hover:border-brand-edge md:inline-flex">
        <SpriteIcon id="search" className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <kbd className="shrink-0 rounded-md border border-line bg-surface-2 px-1.5 font-sans text-xs text-muted">⌘K</kbd>
      </button>
      <button type="button" data-top="search-phone" onClick={show} aria-haspopup="dialog" aria-label={label} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-edge bg-surface text-ink md:hidden">
        <SpriteIcon id="search" className="size-5" />
      </button>
      {open && current ? <CommandPalette tenantId={current.id} role={current.role} pack={frame.pack} labels={labels} names={palette.names} words={palette.words} recentKey={recentKey} onClose={close} /> : null}
    </div>
  );
}
