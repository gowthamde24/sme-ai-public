"use client";

import { Check } from "lucide-react";
import * as React from "react";

import { makeT, type Words } from "../../words";
import { useStoredAsk } from "../ask/ask-store";
import type { Working } from "./lower-data";

/** "Your assistant is working on" (the approved mock): the approved job, its steps with ticks (done, now, later), and Pause / Resume and Undo last step. Pause and Resume are the task's own moves (the same actions as the plan card); Undo last step is a PREVIEW on staging (the step log it needs does not exist yet). */
export default function WorkingOn({ working, time, words }: { working: Working | null; /** The approval time in India ("9:05"), or null. */ time: string | null; words: Words }) {
  const t = makeT(words);
  const session = useStoredAsk();
  const actions = session?.doIt?.actions ?? null;
  const [status, setStatus] = React.useState<Working["status"] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [undone, setUndone] = React.useState(false);
  const now = status ?? working?.status ?? "running";
  const move = async () => {
    if (!working || !actions || busy) return;
    setBusy(true);
    try {
      const out = await (now === "paused" ? actions.resume(working.id) : actions.pause(working.id));
      if (out.ok) setStatus(out.task.status === "paused" ? "paused" : "running");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-part="working-on" aria-labelledby="working-on-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="working-on-h" className="font-display text-xl font-semibold md:text-2xl">
        {t("tv6.wk.title")}
      </h2>
      <div className="rounded-2xl border border-line bg-surface p-[18px] shadow-[var(--v2-shadow)]">
        {working ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <p className="min-w-0 flex-1 basis-48 text-[15px] font-bold">{working.title}</p>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-bg px-2 py-[3px] text-[11.5px] font-bold text-brand-text">{now === "paused" ? t("tv6.wk.paused") : time ? t("tv6.wk.approved", { time }) : t("tv6.wk.approved.notime")}</span>
            </div>
            <ol data-part="work-steps" className="mt-3 flex flex-col gap-2 text-[13.5px]">
              {working.steps.map((s, i) => (
                <li key={s.id} data-step-state={s.state} className={`flex items-center gap-2.5 ${s.state === "later" ? "text-muted" : ""}`}>
                  <span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${s.state === "done" ? "bg-green-bg text-green-text" : s.state === "now" ? "bg-brand text-on-brand" : "bg-surface-2 text-muted"}`}>
                    {s.state === "done" ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="min-w-0">{t(`tv6.wk.${s.id}`, { n: s.n, extra: s.extra, to: s.hoursTo ?? "" })}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" data-write disabled={busy || !actions} onClick={() => void move()} className="inline-flex min-h-11 items-center rounded-[9px] border border-line bg-surface px-3.5 text-[13.5px] font-bold text-ink hover:bg-surface-2 disabled:opacity-60">
                {now === "paused" ? t("tv6.wk.resume") : t("tv6.wk.pause")}
              </button>
              <button type="button" data-write onClick={() => setUndone(true)} className="inline-flex min-h-11 items-center rounded-[9px] border border-line bg-surface px-3.5 text-[13.5px] font-bold text-ink hover:bg-surface-2">
                {t("tv6.wk.undo")}
              </button>
            </div>
            {undone ? (
              <p role="status" className="mt-2 text-xs text-muted">
                {t("tv6.wk.undo_mock")}
              </p>
            ) : null}
          </>
        ) : (
          <p data-empty="working" className="text-sm text-muted">
            {t("tv6.wk.none")}
          </p>
        )}
      </div>
    </section>
  );
}
