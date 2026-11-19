"use client";

import { Gift, MessageCircle, Phone, Search, Sparkles, Store, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { resultSentence } from "@/lib/jobs/result";
import { CHIP_TONE, jobNameKey, jobStatusKey, type Job, type JobKind, type JobSwitched } from "@/lib/jobs/types";

import { JobChip } from "../ds/JobChip";
import type { Reply } from "../cc/kit";
import { makeT, type Words } from "../words";
import { GateNote } from "./GateNote";

export type JobActions = { setEnabled: (jobId: string, enabled: boolean) => Promise<Reply<JobSwitched>> };

const ICON: Record<JobKind, typeof Zap> = { speed_to_lead: Zap, answer_calls: Phone, followups: MessageCircle, store_visits: Store, offers: Gift, researcher: Search, payment_reminders: Wallet, custom: Sparkles };

/** The switch of one job: a round-knob switch (design/jobs.css `jb-switch`), instant on a tap (optimistic) and put back if the change did not go through. The tap area is 44 px through the padding of its button. */
function JobSwitch({ label, on, busy, onChange }: { label: string; on: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)} className="jb-switch-hit write-ctl -my-2 -mr-2 grid min-h-11 min-w-11 shrink-0 place-items-center">
      <span className="jb-switch" aria-hidden="true" data-on={on ? "" : undefined} />
    </button>
  );
}

/**
 * One job as a compact row (phone density v2): its icon, its name (the plain job name, or the one the owner gave it), the ONE result line, and a solid chip when it needs a look (waiting, failed, done, paused); a failed job carries its fix as a button.
 * The words open the job's page; the switch stops or starts only this job. The words come from `jobs.*` (the API sends codes and numbers, never prose).
 */
export function JobRow({ job, words, base, actions }: { job: Job; words: Words; base: string; actions: JobActions | null }) {
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
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-bg text-brand-text">
        <Icon className="size-[18px]" />
      </span>
      <Link href={href} prefetch={false} className="min-w-0 flex-1 no-underline">
        <span className="block text-[15px] font-semibold leading-snug text-ink max-md:line-clamp-2">{name}</span>
        <span className="block text-[12.5px] leading-snug text-muted">{resultSentence(t, job.result)}</span>
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
      <JobSwitch label={name} on={now.enabled} busy={busy || !actions} onChange={(next) => void change(next)} />
    </div>
  );
}
