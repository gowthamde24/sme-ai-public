"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import type { SheetLoad, TemplateSeason } from "@/lib/jobs/templates";

import { makeT, type Words } from "../../words";
import { LazySheet, loadSheet } from "./LazySheet";
import type { SheetActions } from "./types";

/** What opens the sheet in one place: its state, the chunk loaded on the first touch of the button, focus back on the button when it closes. */
export function useSheet(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen);
  const [ask, setAsk] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [season, setSeason] = useState<TemplateSeason | null>(null);
  const back = useRef<HTMLElement | null>(null);
  return {
    open,
    ask,
    template,
    season,
    show(from: HTMLElement | null, opts?: { ask?: string | null; template?: string | null; season?: TemplateSeason | null }) {
      back.current = from;
      setAsk(opts?.ask ?? null);
      setTemplate(opts?.template ?? null);
      setSeason(opts?.season ?? null);
      setOpen(true);
    },
    close() {
      setOpen(false);
      setAsk(null);
      setTemplate(null);
      setSeason(null);
      requestAnimationFrame(() => back.current?.focus());
    },
  };
}

/**
 * The "New job" button of Today and the Jobs page (JOBS): opens the New job sheet. Only the Owner and an Admin start jobs, so `actions` is null for the others and no button is drawn. `defaultOpen` + `initial` = the sheet was asked for in the address (`?new=1`)
 * and the server already read the ideas.
 */
export function NewJobButton({ words, base, actions, initial, defaultOpen = false, size = "md" }: { words: Words; base: string; actions: SheetActions | null; initial?: SheetLoad | null; defaultOpen?: boolean; size?: "sm" | "md" }) {
  const t = makeT(words);
  const sheet = useSheet(defaultOpen);
  const btn = useRef<HTMLButtonElement>(null);
  if (!actions) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        data-action="new-job"
        aria-haspopup="dialog"
        onPointerEnter={() => void loadSheet()}
        onFocus={() => void loadSheet()}
        onTouchStart={() => void loadSheet()}
        onClick={() => sheet.show(btn.current)}
        className={`jb-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-brand-edge bg-brand font-bold text-on-brand ${size === "sm" ? "min-h-10 px-3.5 text-[14px]" : "min-h-11 px-5 text-[15px]"}`}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("jobs.page.start")}
      </button>
      {sheet.open ? <LazySheet words={words} base={base} actions={actions} onClose={sheet.close} initial={initial} /> : null}
    </>
  );
}
