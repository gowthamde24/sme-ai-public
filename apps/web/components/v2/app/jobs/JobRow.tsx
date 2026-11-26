"use client";

import { AudioLines, Gift, Languages, MessageCircle, Phone, Search, Sparkles, Store, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { resultSentence } from "@/lib/jobs/result";
import { CHIP_TONE, jobNameKey, jobStatusKey, type Job, type JobKind, type JobSpeaks, type JobSwitched } from "@/lib/jobs/types";

import { JobChip } from "../ds/JobChip";
import { StatusSwitch } from "../ds/StatusSwitch";
import type { Reply } from "../cc/kit";
import { makeT, type Say, type Words } from "../words";
import { GateNote } from "./GateNote";

export type JobActions = { setEnabled: (jobId: string, enabled: boolean) => Promise<Reply<JobSwitched>> };

export const ICON: Record<JobKind, typeof Zap> = { speed_to_lead: Zap, answer_calls: Phone, followups: MessageCircle, store_visits: Store, offers: Gift, researcher: Search, payment_reminders: Wallet, custom: Sparkles };

/** The switch of one job: the shared green-on, red-off StatusSwitch with the word beside it, instant on a tap (optimistic) and put back if the change did not go through. The tap area is 44 px through the padding of its button. */
function JobSwitch({ label, on, busy, onChange, onText, offText }: { label: string; on: boolean; busy: boolean; onChange: (next: boolean) => void; onText: string; offText: string }) {
  return (
    <StatusSwitch on={on} label={label} onText={onText} offText={offText} busy={busy} onChange={onChange} />
  );
}

const pc = "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink";
/** How a named job sounds: its language, its voice and the number it speaks from, as small outline chips (a word we do not know is left out, never shown as a code). */
export function SpeaksChips({ speaks, t, words }: { speaks: JobSpeaks; t: Say; words: Words }) {
  const lang = speaks.language ? (words[`jobs.page.lang.${speaks.language}`] ? t(`jobs.page.lang.${speaks.language}`) : null) : null;
  const num = speaks.number ? t(words[`jobs.page.number.${speaks.number}`] ? `jobs.page.number.${speaks.number}` : "jobs.page.number.other") : null;
  // the chip shows the voice's NAME ("Ramya", sent with the voice); an id with no name is left out, never shown as a code
  const voice = speaks.voiceName ? t("jobs.page.voice", { name: speaks.voiceName }) : null;
  if (!lang && !voice && !num) return null;
  return (
    <span data-part="job-speaks" className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {lang ? (
        <span data-chip="language" className={pc}>
          <Languages aria-hidden="true" className="size-3.5 text-muted" />
          {lang}
        </span>
      ) : null}
      {voice ? (
        <span data-chip="voice" className={pc}>
          <AudioLines aria-hidden="true" className="size-3.5 text-muted" />
          {voice}
        </span>
      ) : null}
      {num ? (
        <span data-chip="number" className={pc}>
          <Phone aria-hidden="true" className="size-3.5 text-muted" />
          {num}
        </span>
      ) : null}
    </span>
  );
}

/**
 * One job as a compact row (phone density v2): its icon, its name (the plain job name, or the one the owner gave it), the ONE result line, and a solid chip when it needs a look (waiting, failed, done, paused); a failed job carries its fix as a button.
 * The words open the job's page; the switch stops or starts only this job. The words come from `jobs.*` (the API sends codes and numbers, never prose).
 */
export function JobRow({ job, words, base, actions, chips = false }: { job: Job; words: Words; base: string; actions: JobActions | null; /** the Jobs page draws the language, voice and number chips of a job that has them (Today does not) */ chips?: boolean }) {
  const t = makeT(words);
  const [now, setNow] = useState({ enabled: job.enabled, status: job.status });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = ICON[job.kind];
  const name = job.customName ?? t(jobNameKey(job.kind));
  const href = `${base}/jobs/${job.id}`;
  const showChip = now.status !== "running";

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

  return (
    <div data-job={job.id} data-job-kind={job.kind} className="flex items-center gap-3 px-4 py-2.5">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand-text">
        <Icon className="size-[18px]" />
      </span>
      {/* the shared tap-target rule (`main a` = inline-flex, a row) would put the name, the result line and the chips side by side: this link stacks them (staging, 20 Nov: rows were squeezed into columns on a phone) */}
      <Link href={href} prefetch={false} className="flex min-w-0 flex-1 flex-col items-start justify-center no-underline">
        <span className="block text-[15px] font-semibold leading-snug text-ink max-md:line-clamp-2">{name}</span>
        {job.customName ? null : <span className="block text-[12.5px] leading-snug text-muted" data-part="job-sentence">{t(`jobs.sentence.${job.kind}`)}</span>}
        <span data-part="job-result" className="block text-[12.5px] leading-snug text-muted">{resultSentence(t, job.result)}</span>
        {chips && job.speaks ? <SpeaksChips speaks={job.speaks} t={t} words={words} /> : null}
        {job.planGate ? <GateNote gate={job.planGate} t={t} className="mt-1" /> : null}
        {showChip || job.fix ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            {showChip ? <JobChip tone={now.status === job.status ? CHIP_TONE[job.status] : CHIP_TONE[now.status]}>{t(jobStatusKey(now.status), { n: job.needsYou })}</JobChip> : null}
            {job.fix ? <span className="text-sm font-semibold text-brand-text underline underline-offset-4">{t(`jobs.fix.${job.fix.code}`, { n: job.fix.count })}</span> : null}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="mt-1 block text-sm text-red-text">
            {error}
          </span>
        ) : null}
      </Link>
      <JobSwitch label={name} on={now.enabled} busy={busy || !actions} onChange={(next) => void change(next)} onText={t("jobs.sw.on")} offText={t("jobs.sw.off")} />
    </div>
  );
}
