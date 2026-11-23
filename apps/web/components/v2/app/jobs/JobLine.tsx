"use client";

import Link from "next/link";
import { useState } from "react";

import { fmtDay, resultSentence } from "@/lib/jobs/result";
import { jobGateKey, jobNameKey, type Job } from "@/lib/jobs/types";

import { SpeaksChips, type JobActions } from "./JobRow";
import { makeT, type Words } from "../words";

/**
 * One job as a line of the OPEN list (owner chose the open layout, 24 Nov): the name, ONE honest status line (a dot and a sentence: orange only where the owner must act), and ONE action: Review (it
 * needs you), Turn on (it is paused) or the switch (it is running). No icon tile, no pill, no card: the line sits on the page between hairlines (the list draws them). Today keeps its own JobRow.
 * The words come from `jobs.*`; the status never says "Working on it" for a job that is off.
 */
export function JobLine({ job, words, base, actions }: { job: Job; words: Words; base: string; actions: JobActions | null }) {
  const t = makeT(words);
  const [now, setNow] = useState({ enabled: job.enabled, status: job.status });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = job.customName ?? t(jobNameKey(job.kind));
  const href = `${base}/jobs/${job.id}`;
  const off = !now.enabled || now.status === "paused";
  const needs = !off && (now.status === "waiting" || now.status === "failed" || job.needsYou > 0);

  async function change(next: boolean) {
    if (!actions) return;
    const before = now;
    setNow({ enabled: next, status: next ? (before.status === "paused" ? "running" : before.status) : "paused" });
    setBusy(true);
    setError(null);
    const r = await actions.setEnabled(job.id, next);
    setBusy(false);
    if (!r.ok) {
      setNow(before);
      setError(r.error);
      return;
    }
    setNow({ enabled: r.data.enabled, status: r.data.status });
  }

  // the ONE status sentence: what is true now, never a line from another state. The API's own result line is used when it says something ("2 messages need a template to go out"); the generic
  // "Working on it" is never shown (it said that under a Paused pill): a plain state word takes its place.
  const result = resultSentence(t, job.result);
  const generic = result === t("jobs.res.other");
  const ran = job.lastRunAt ? fmtDay(job.lastRunAt) : "";
  const status = off
    ? job.result.code === "paused_on"
      ? result
      : ran
        ? t("jobs.line.paused_ran", { day: ran })
        : t("jobs.line.paused")
    : needs
      ? job.planGate
        ? t(jobGateKey(job.planGate))
        : !generic
          ? result
          : now.status === "failed"
            ? t("jobs.status.failed")
            : t("jobs.status.waiting")
      : generic
        ? t("jobs.status.running")
        : result;

  return (
    <div data-job={job.id} data-job-kind={job.kind} data-state={off ? "off" : needs ? "needs" : "running"} className="flex items-center gap-4 border-t border-line py-4 first:border-t-0">
      <Link href={href} prefetch={false} className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 no-underline">
        <span className="block text-[17px] font-semibold leading-snug text-ink">{name}</span>
        <span className="flex items-start gap-2 text-[15px] leading-snug text-muted">
          <span aria-hidden="true" className={`mt-[7px] size-2 shrink-0 rounded-full ${needs ? "bg-brand" : "bg-muted"}`} />
          <span className={needs ? "font-medium text-brand-text" : ""}>{status}</span>
        </span>
        {job.speaks ? <SpeaksChips speaks={job.speaks} t={t} words={words} /> : null}
        {error ? (
          <span role="alert" className="block text-sm text-red-text">
            {error}
          </span>
        ) : null}
      </Link>
      {needs ? (
        <Link href={href} prefetch={false} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-brand-edge bg-brand px-4 text-[15px] font-semibold text-on-brand no-underline">
          {t("jobs.line.review")}
        </Link>
      ) : off ? (
        <button type="button" disabled={busy || !actions} onClick={() => void change(true)} className="write-ctl inline-flex min-h-11 shrink-0 items-center rounded-lg border border-edge bg-surface px-4 text-[15px] font-semibold text-ink disabled:opacity-60">
          {t("jobs.line.turn_on")}
        </button>
      ) : (
        <button type="button" role="switch" aria-checked={true} aria-label={name} disabled={busy || !actions} onClick={() => void change(false)} className="jb-switch-hit write-ctl -my-2 -mr-2 grid min-h-11 min-w-11 shrink-0 place-items-center">
          <span className="jb-switch" aria-hidden="true" data-on="" />
        </button>
      )}
    </div>
  );
}
