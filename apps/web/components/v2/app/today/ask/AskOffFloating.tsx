"use client";

import { X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { workspaceOf } from "../../nav";
import { orbHidden } from "./ask-chips";
import { AskOff } from "./AskOff";
import type { AskWords } from "./ask-words";

/**
 * The floating orb of a workspace whose assistant is switched OFF (every screen but Today and the live call, like AskFloating): pressed, it opens a small dialog with the question line where it will be and the reason, with the one button that turns
 * the assistant on for the Owner or an Admin (AskOff). Without it a new workspace had no orb at all, so no way to find out why there was nowhere to type. Esc or the close button returns to the circle.
 */
export function AskOffFloating({ words }: { words: AskWords }) {
  const pathname = usePathname();
  const tab = useSearchParams()?.get("tab") ?? null;
  const rest = workspaceOf(pathname ?? "")?.rest ?? null;
  const here = rest !== null && !orbHidden(rest, tab);
  const [open, setOpen] = React.useState(false);
  const [shownFor, setShownFor] = React.useState(pathname);
  const orbRef = React.useRef<HTMLButtonElement>(null);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    if (open) setOpen(false);
  }
  const close = React.useCallback(() => {
    setOpen(false);
    window.setTimeout(() => orbRef.current?.focus(), 0);
  }, []);
  if (!here) return null;
  const w = (key: string) => words[key] ?? key;
  const name = w("ask.orb.open");
  return (
    <>
      <button
        ref={orbRef}
        type="button"
        data-ask="orb"
        data-ask-off="true"
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={name}
        onClick={() => (open ? close() : setOpen(true))}
        className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] right-4 z-30 grid size-14 place-items-center rounded-full border border-line bg-surface opacity-80 shadow-[var(--v2-shadow-pop)] transition-transform duration-150 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text md:bottom-6 md:right-6"
      >
        <Orb px={44} state="ambient" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-[55] print:hidden" data-ask="panel-root" onKeyDown={(e) => e.key === "Escape" && close()}>
          <div aria-hidden="true" className="absolute inset-0 bg-charcoal/40 md:bg-transparent" onClick={close} />
          <div role="dialog" aria-modal="true" aria-label={w("ask.panel.title")} data-ask="panel" className="absolute inset-x-0 bottom-0 flex flex-col gap-3 overflow-hidden rounded-t-2xl border border-line bg-bg p-4 shadow-[var(--v2-shadow-pop)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px] md:rounded-2xl">
            <div className="flex min-h-11 items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{w("ask.panel.title")}</h2>
              <button type="button" onClick={close} aria-label={w("ask.panel.close")} title={w("ask.panel.close")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface hover:bg-surface-2">
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <AskOff look="panel" words={words} />
          </div>
        </div>
      ) : null}
    </>
  );
}
