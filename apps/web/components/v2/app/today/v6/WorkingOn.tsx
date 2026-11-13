"use client";

import * as React from "react";

import { makeT, type Words } from "../../words";
import { useStoredAsk } from "../ask/ask-store";
import { hourText, percentDone, type Working } from "./lower-data";

/** "Your assistant is working on" (the final design): the approved job, a progress bar and one line ("5 of 9 called · 2 will visit Saturday · calling hours till 8 pm"), then Pause / Resume and Undo last step. Pause and Resume are the task's own moves (the same actions as the plan card); Undo last step is a PREVIEW on staging (the step log it needs does not exist yet). */
export default function WorkingOn({ working, words }: { working: Working | null; words: Words }) {
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
  const btn = "inline-flex min-h-11 items-center rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-60";
  return (
    <section data-part="working-on" aria-labelledby="working-on-h" className="min-w-0">
      <h2 id="working-on-h" className="mb-2.5 font-display text-[17px] font-extrabold">
        {t("tv6.wk.title")}
      </h2>
      <div className="rounded-[18px] border border-line bg-surface p-4 shadow-[var(--v2-shadow)]">
        {working ? (
          <>
            <p className="text-sm font-bold">{working.title}</p>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentDone(working)} aria-label={working.title} className="my-2.5 h-1.5 overflow-hidden rounded-full bg-line">
              <span style={{ display: "block", height: "100%", width: `${percentDone(working)}%` }}>
                <i className="block h-full rounded-full bg-gradient-to-r from-brand/60 to-brand" />
              </span>
            </div>
            <p data-part="work-line" className="text-[12.5px] text-muted">
              {now === "paused" ? `${t("tv6.wk.paused")} · ` : ""}
              {t("tv6.wk.line", { done: working.done, total: working.total })}
              {working.positive > 0 ? ` · ${t("tv6.wk.interested", { n: working.positive })}` : ""}
              {working.toMinute !== null && working.waiting > 0 ? ` · ${t("tv6.wk.hours", { to: hourText(working.toMinute) })}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" data-write disabled={busy || !actions} onClick={() => void move()} className={btn}>
                {now === "paused" ? t("tv6.wk.resume") : t("tv6.wk.pause")}
              </button>
              <button type="button" data-write onClick={() => setUndone(true)} className={btn}>
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
