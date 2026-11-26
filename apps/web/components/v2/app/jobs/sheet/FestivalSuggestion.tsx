"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { FestivalHint } from "@/lib/jobs/festival";

import { makeT, type Words } from "../../words";
import { SampleChip } from "../SampleChip";
import { LazySheet } from "./LazySheet";
import { useSheet } from "./NewJobButton";
import type { SheetActions } from "./types";

const WEEK_MS = 7 * 86_400_000;
/** The browser's own store of "hidden until": read through `useSyncExternalStore`, so the server and the first paint say "not hidden" and the browser corrects it without an effect. */
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};
const changed = () => listeners.forEach((cb) => cb());
const key = (f: FestivalHint) => `jobs-festival-hidden:${f.season}:${f.date}`;
function hiddenNow(f: FestivalHint): boolean {
  try {
    const until = Number(window.localStorage.getItem(key(f)) ?? "0");
    return until > Date.now();
  } catch {
    return false;
  }
}

/**
 * The assistant's suggestion on Today (mock r3-02 E): "{festival} is in {n} days. Want me to prepare the festival offer?" with "Yes, show me" (the New job sheet on that festival's plan) and "Not now" (hidden for a week, with Undo). One suggestion at a time; drawn only when
 * the festival calendar has a festival ahead (the row is not there while C1's calendar does not exist). The hidden state lives in this browser only (a convenience: it can be lost and the suggestion simply comes back).
 */
export function FestivalSuggestion({ festival, words, base, actions }: { festival: FestivalHint; words: Words; base: string; actions: SheetActions }) {
  const t = makeT(words);
  const sheet = useSheet();
  const yes = useRef<HTMLButtonElement>(null);
  const hidden = useSyncExternalStore(subscribe, () => hiddenNow(festival), () => false);
  const [toast, setToast] = useState(false);
  function later() {
    try {
      window.localStorage.setItem(key(festival), String(Date.now() + WEEK_MS));
    } catch {
      /* private window: it just comes back next time */
    }
    changed();
    setToast(true);
  }
  function undo() {
    try {
      window.localStorage.removeItem(key(festival));
    } catch {
      /* nothing to undo */
    }
    changed();
    setToast(false);
  }
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(false), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);
  return (
    <>
      {!hidden ? (
        <section data-part="festival-suggestion" aria-label={t("jobs.tpl.fest.eyebrow")} className="jb-enter flex flex-col gap-3 rounded-xl bg-brand-bg p-3.5">
          <p className="m-0 flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-brand-text">
            <Sparkles aria-hidden="true" className="size-4" />
            {t("jobs.tpl.fest.eyebrow")}
            {festival.sample ? <SampleChip words={words} /> : null}
          </p>
          <p className="m-0 text-[17px] font-semibold leading-snug text-ink">{t(festival.days === 0 ? "jobs.tpl.fest.msg_today" : "jobs.tpl.fest.msg", { festival: festival.name, n: festival.days })}</p>
          <div className="flex flex-wrap gap-2.5">
            <button ref={yes} type="button" data-action="fest-yes" onClick={() => sheet.show(yes.current, { season: festival.season })} className="jb-press inline-flex min-h-11 items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand">
              {t("jobs.tpl.fest.yes")}
            </button>
            <button type="button" data-action="fest-later" onClick={later} className="jb-press inline-flex min-h-11 items-center justify-center rounded-md border border-edge bg-surface px-5 text-[15px] font-semibold text-ink">
              {t("jobs.tpl.fest.no")}
            </button>
          </div>
        </section>
      ) : null}
      {toast ? (
        <div role="status" data-part="fest-toast" className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8">
          <span className="jb-enter flex items-center gap-3 rounded-md bg-ink py-1.5 pl-4 pr-1.5 text-[14px] font-semibold text-bg shadow-[var(--v2-shadow)]">
            {t("jobs.tpl.fest.hidden")}
            <button type="button" data-action="fest-undo" onClick={undo} className="inline-flex min-h-9 items-center rounded-md bg-bg px-3.5 text-[14px] font-bold text-ink">
              {t("jobs.tpl.fest.undo")}
            </button>
          </span>
        </div>
      ) : null}
      {sheet.open ? <LazySheet words={words} base={base} actions={actions} onClose={sheet.close} initialSeason={sheet.season} /> : null}
    </>
  );
}
