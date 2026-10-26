"use client";

import { X } from "lucide-react";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { AskAnswer, AskChips, AskForm, AskVoiceMode } from "./AskView";
import type { AskSession } from "./use-ask-session";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The panel the floating orb opens (job DQ part 0): on a laptop a small chat anchored bottom right (about 380 by 560), on a phone a sheet from the bottom (about 70 % of the screen). The thread and the line are the workspace's shared
 * ones (the same exchange is on Today). It is a dialog: the focus goes to the line when it opens, Tab stays inside it, Esc and the close button return to the orb. The page behind stays where it is. Reduced motion: it appears without sliding.
 */
export function AskPanel({ session, chips, onClose }: { session: AskSession; chips: readonly string[]; onClose: () => void }) {
  const s = session;
  const { w } = s;
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    document.getElementById("ask-input")?.focus();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (s.voiceOpen) return; // voice mode closes itself first
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="fixed inset-0 z-[55] print:hidden" data-ask="panel-root">
      <div aria-hidden="true" className="absolute inset-0 bg-charcoal/40 md:bg-transparent" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={w("ask.panel.title")}
        data-ask="panel"
        onKeyDown={onKeyDown}
        className="absolute inset-x-0 bottom-0 flex h-[70dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-bg shadow-[var(--v2-shadow-pop)] motion-safe:animate-[ask-panel-in_160ms_ease-out] md:inset-x-auto md:bottom-6 md:right-6 md:h-[560px] md:max-h-[calc(100dvh-3rem)] md:w-[380px] md:rounded-2xl"
      >
        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <Orb px={28} state={s.asking && !s.answer ? "think" : s.playing || s.asking ? "speak" : "ambient"} />
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{w("ask.panel.title")}</h2>
          <button type="button" onClick={onClose} aria-label={w("ask.panel.close")} title={w("ask.panel.close")} data-ask="panel-close" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface hover:bg-surface-2">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-ask="panel-body">
          {s.phase === "idle" && s.earlier.length === 0 ? <p className="text-sm text-muted">{w("ask.sub")}</p> : null}
          <AskAnswer session={s} earlierWord={w("ask.earlier")} scrollRoot />
        </div>
        <div className="shrink-0 space-y-3 border-t border-line bg-surface px-4 pb-4 pt-3">
          <AskChips session={s} chips={chips} />
          <AskForm session={s} look="panel" placeholder={w("ask.placeholder.hero")} />
        </div>
      </div>
      <AskVoiceMode session={s} />
    </div>
  );
}
