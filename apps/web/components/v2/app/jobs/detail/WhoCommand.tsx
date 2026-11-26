"use client";

import { Mic } from "lucide-react";
import { useState } from "react";

import type { SpeaksPatch, WhoLanguage } from "@/lib/jobs/who";

import { JobChip } from "../../ds/JobChip";
import type { Say } from "../../words";
import { jobBtnMain, jobBtnQuiet } from "./types";

/** The other job the command is about: its plain name (`jobs.kind.<kind>`), the short word for the sentence (`jobs.who.ask.job.<kind>`), how it speaks now and how the command would make it speak. */
export type WhoCommandProps = {
  jobId: string;
  /** the job's name as the owner sees it ("Book and remind store visits", or the name they gave it) */
  jobName: string;
  /** the short word in the command sentence ("visits") */
  short: string;
  from: WhoLanguage;
  to: WhoLanguage;
  /** The same one patch the assistant's `jobs.change` sends. */
  change: (jobId: string, patch: SpeaksPatch) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/**
 * "Or just ask your assistant: Make the visits job speak Telugu." The sentence is the command (a tap says it for the owner); the answer is a plan card in plain words (nothing has changed yet), "Yes, change it" / "No", then "Visits job now speaks Telugu" with Undo.
 * What it changes is only the language of that job's NEXT reminders and calls: nothing already sent changes, the voice and the number stay.
 */
export function WhoCommand(p: WhoCommandProps & { t: Say }) {
  const { t } = p;
  const [stage, setStage] = useState<"idle" | "plan" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<WhoLanguage>(p.from);
  const word = (l: WhoLanguage) => t(`jobs.opt.language.${l}`);

  async function go(to: WhoLanguage, next: "idle" | "done") {
    setBusy(true);
    setError(null);
    const r = await p.change(p.jobId, { language: to });
    setBusy(false);
    if (!r.ok) return void setError(r.error);
    setNow(to);
    setStage(next);
  }

  return (
    <div data-part="who-command" className="mt-4 border-t border-line pt-4">
      <p className="m-0 text-[12px] font-bold uppercase tracking-wider text-muted">{t("jobs.who.ask.title")}</p>
      {stage === "idle" ? (
        <button type="button" data-action="who-command" onClick={() => (setError(null), setStage("plan"))} className="jb-press mt-2 flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-brand-edge bg-surface px-3.5 py-2 text-left text-[16px] text-ink">
          <Mic aria-hidden="true" className="size-[18px] shrink-0 text-brand-text" />
          <span>“{t("jobs.who.ask.say", { job: p.short, language: word(p.to) })}”</span>
        </button>
      ) : null}
      {stage === "plan" ? (
        <article data-part="who-plan" aria-label={t("jobs.who.plan.title", { job: p.jobName })} className="jb-enter mt-2 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--v2-shadow)]">
          <p className="m-0 mb-2 flex items-center gap-2 text-[11.5px] font-bold uppercase leading-tight tracking-wider text-muted">
            <span className="min-w-0 flex-1">{t("jobs.who.plan.eyebrow")}</span>
            <JobChip tone="info" className="shrink-0">
              {t("jobs.new.plan.draft")}
            </JobChip>
          </p>
          <h3 className="m-0 font-display text-[17px] font-bold leading-snug text-ink">{t("jobs.who.plan.title", { job: p.jobName })}</h3>
          <p data-part="who-plan-change" className="m-0 mt-2.5 border-t border-line pt-2.5 text-[15px] text-ink">
            <b>{t("jobs.who.plan.language")}</b> · {word(p.from)} → <b>{word(p.to)}</b>
          </p>
          <p className="m-0 mt-1.5 text-[14px] leading-snug text-muted">{t("jobs.who.plan.help", { language: word(p.to) })}</p>
          {error ? (
            <p role="alert" className="m-0 mt-2 text-sm text-red-text">
              {error}
            </p>
          ) : null}
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <button type="button" data-action="who-yes" disabled={busy} onClick={() => void go(p.to, "done")} className={jobBtnMain}>
              {t("jobs.who.plan.yes")}
            </button>
            <button type="button" data-action="who-no" disabled={busy} onClick={() => setStage("idle")} className={jobBtnQuiet}>
              {t("jobs.who.plan.no")}
            </button>
          </div>
        </article>
      ) : null}
      {stage === "done" ? (
        <div data-part="who-done" role="status" className="jb-enter mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--jb-done-soft)] px-3.5 py-3">
          <span className="min-w-0 text-[15px] font-semibold text-ink">{t("jobs.who.plan.done", { job: p.short, language: word(now) })}</span>
          <button type="button" data-action="who-undo" disabled={busy} onClick={() => void go(p.from, "idle")} className={jobBtnQuiet}>
            {t("jobs.job.undo")}
          </button>
        </div>
      ) : null}
      {error && stage !== "plan" ? (
        <p role="alert" className="m-0 mt-2 text-sm text-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
