"use client";

import { StatusSwitch } from "../ds/StatusSwitch";
import Link from "next/link";
import { useState } from "react";

import { fmtDay, resultSentence } from "@/lib/jobs/result";
import { jobGateKey, jobNameKey, jobState, type Job } from "@/lib/jobs/types";

import { ICON, SpeaksChips, type JobActions } from "./JobRow";
import { makeT, type Words } from "../words";

/**
 * One job as a line of the OPEN list (owner chose the open layout, 24 Nov): the name, ONE honest status line (a dot and a sentence: orange only where the owner must act), and ONE action: Review (it
 * needs you), Turn on (it is paused) or the switch (it is running). No icon tile, no pill, no card: the line sits on the page between hairlines (the list draws them). Today keeps its own JobRow.
 * The words come from `jobs.*`; the status never says "Working on it" for a job that is off.
 */
/** The category colour of a job's bare line icon (design system, CATEGORY COLOURS): calls blue, chats green, visits violet, offers gold, finding teal. */
export const JOB_CATEGORY: Record<Job["kind"], "call" | "chat" | "visit" | "offer" | "find"> = { speed_to_lead: "call", answer_calls: "call", followups: "chat", store_visits: "visit", offers: "offer", researcher: "find", payment_reminders: "chat", custom: "chat" };

export function JobLine({ job, words, base, actions }: { job: Job; words: Words; base: string; actions: JobActions | null }) {
  const Icon = ICON[job.kind];
  const t = makeT(words);
  const [now, setNow] = useState({ enabled: job.enabled, status: job.status });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = job.customName ?? t(jobNameKey(job.kind));
  const href = `${base}/jobs/${job.id}`;
  const blocked = job.planGate !== null; // something is missing: the job cannot run, so it is never plain Paused
  const off = !blocked && (!now.enabled || now.status === "paused");
  const needs = blocked || (!off && jobState({ ...job, enabled: now.enabled, status: now.status }) === "needs");
  // the place that fixes what is missing (the action's link): the number, WhatsApp, billing; any other need opens the job
  const fixHref = job.planGate === "no_number" ? `${base}/phone-number` : job.planGate === "no_whatsapp" ? `${base}/integrations` : job.planGate === "minutes_used" || job.planGate === "billing_blocked" ? `${base}/billing` : href;
  const fixLabel = job.planGate ? t(`jobs.line.act.${job.planGate}`) : t("jobs.line.review");

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
    <div
      data-job={job.id}
      data-job-kind={job.kind}
      data-part="job-card"
      data-state={off ? "off" : needs ? "needs" : "running"}
      className={`flex h-full min-w-0 flex-col justify-center rounded-xl border bg-surface p-4 text-left ${needs ? "border-ink" : "border-line"}`}
    >
      <div className={`flex gap-3 ${needs || off ? "flex-col sm:flex-row sm:items-center" : "items-center"}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
        <Icon aria-hidden="true" data-k={JOB_CATEGORY[job.kind]} className="mt-0.5 size-6 shrink-0" strokeWidth={1.8} />
        <Link href={href} prefetch={false} className="flex min-w-0 flex-1 flex-col items-start gap-1 no-underline">
          <span className="block text-[17px] font-semibold leading-snug text-ink">{name}</span>
          <span className="flex items-start gap-2 text-[15px] leading-snug text-muted">
            <span aria-hidden="true" className={`mt-[7px] size-2 shrink-0 rounded-full ${needs ? "bg-brand" : off ? "border border-muted" : "bg-green-text"}`} />
            <span className={needs ? "font-medium text-brand-text" : ""}>{status}</span>
          </span>
          {job.speaks ? <SpeaksChips speaks={job.speaks} t={t} words={words} /> : null}
          {error ? (
            <span role="alert" className="block text-sm text-red-text">
              {error}
            </span>
          ) : null}
        </Link>
        </div>
        {needs ? (
          <Link href={fixHref} prefetch={false} className="inline-flex min-h-11 shrink-0 items-center self-start rounded-lg border border-ink bg-surface px-4 sm:self-center text-[15px] font-semibold text-ink no-underline">
            {fixLabel}
          </Link>
        ) : off ? (
          <button type="button" disabled={busy || !actions} onClick={() => void change(true)} className="write-ctl inline-flex min-h-11 shrink-0 items-center self-start rounded-lg border border-edge sm:self-center bg-surface px-4 text-[15px] font-semibold text-ink disabled:opacity-60">
            {t("jobs.line.turn_on")}
          </button>
        ) : (
          <StatusSwitch on label={name} onText={t("jobs.sw.on")} offText={t("jobs.sw.off")} busy={busy || !actions} onChange={() => void change(false)} />
        )}
      </div>
    </div>
  );
}
