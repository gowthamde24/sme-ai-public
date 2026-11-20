"use client";

import { Gift, MessageCircle, Pencil, Phone, Search, Sparkles, Store, Wallet, Zap } from "lucide-react";
import { useState } from "react";

import type { Ago } from "@/lib/jobs/detail";
import { CHIP_TONE, jobStatusKey, type JobKind, type JobStatus, type PlanGate } from "@/lib/jobs/types";

import { JobChip } from "../../ds/JobChip";
import type { Say } from "../../words";
import { GateNote } from "../GateNote";
import { JobRenameForm } from "./LazyJobLists";
import { jobCard } from "./types";

const ICON: Record<JobKind, typeof Zap> = { speed_to_lead: Zap, answer_calls: Phone, followups: MessageCircle, store_visits: Store, offers: Gift, researcher: Search, payment_reminders: Wallet, custom: Sparkles };

export type HeaderProps = {
  kind: JobKind;
  plainName: string;
  /** The name the owner gave, or null. */
  customName: string | null;
  business: string;
  /** Does this job talk to customers? Only then "Customers hear ..." is shown under the name. */
  talks: boolean;
  what: string;
  status: JobStatus;
  needsYou: number;
  /** What blocks the job before it can run (a phone number, WhatsApp, free minutes, billing), or null. */
  gate: PlanGate | null;
  enabled: boolean;
  ago: Ago | null;
  t: Say;
  /** Null = the person only reads. */
  canChange: boolean;
  busy: boolean;
  error: string | null;
  onSwitch: (next: boolean) => void;
  onRename: (name: string) => Promise<boolean>;
};

function lastRun(t: Say, ago: Ago | null): string {
  if (!ago) return t("jobs.job.last.never");
  if (ago.unit === "now") return t("jobs.job.last.now");
  return t(`jobs.job.last.${ago.unit}`, { n: ago.n });
}

/**
 * The top card of a job's page: its name (tap the name or the pencil to rename: 40 characters at most, empty = the plain name; under the box "Customers hear: ..." as they type), the switch, the solid chip and the "Last run" line.
 * The name is only a name: customers always hear "the AI assistant of {business}" with it.
 */
export function JobHeader(p: HeaderProps) {
  const { t } = p;
  const Icon = ICON[p.kind];
  const shown = p.customName ?? p.plainName;
  const [editing, setEditing] = useState(false);

  function open() {
    if (p.canChange) setEditing(true);
  }

  return (
    <section data-part="job-header" className={jobCard}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand-text">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? null : (
            <div className="flex items-start gap-1">
              <h1 className="m-0 min-w-0 font-display text-[22px] font-bold leading-tight text-ink md:text-2xl">
                {p.canChange ? (
                  <button type="button" onClick={open} className="write-ctl -mx-1 rounded-lg px-1 text-left font-[inherit] text-[inherit] leading-[inherit]">
                    {shown}
                  </button>
                ) : (
                  shown
                )}
              </h1>
              {p.canChange ? (
                <button type="button" onClick={open} aria-label={t("jobs.job.rename")} className="write-ctl -my-1 grid size-10 shrink-0 place-items-center rounded-full text-brand-text">
                  <Pencil aria-hidden="true" className="size-[18px]" />
                </button>
              ) : null}
            </div>
          )}
          {editing ? null : <p className="m-0 mt-1 text-[15px] leading-snug text-muted">{p.what}</p>}
        </div>
      </div>

      {editing ? <JobRenameForm plainName={p.plainName} customName={p.customName} business={p.business} talks={p.talks} t={t} onRename={p.onRename} onClose={() => setEditing(false)} /> : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <JobChip tone={CHIP_TONE[p.status]}>{t(jobStatusKey(p.status), { n: p.needsYou })}</JobChip>
          <span data-part="last-run" className="text-sm text-muted">
            {lastRun(t, p.ago)}
          </span>
        </div>
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          {p.enabled ? t("jobs.job.on") : t("jobs.job.off")}
          <button type="button" role="switch" aria-checked={p.enabled} aria-label={shown} disabled={p.busy || !p.canChange} onClick={() => p.onSwitch(!p.enabled)} className="jb-switch-hit write-ctl -my-2 -mr-2 grid min-h-11 min-w-11 shrink-0 place-items-center">
            <span className="jb-switch" aria-hidden="true" data-on={p.enabled ? "" : undefined} />
          </button>
        </span>
      </div>
      {p.gate ? <GateNote gate={p.gate} t={t} className="mt-3 rounded-xl bg-[var(--jb-wait-soft)] px-3 py-2.5" /> : null}
      {p.error ? (
        <p role="alert" className="m-0 mt-2 text-sm text-red-text">
          {p.error}
        </p>
      ) : null}
    </section>
  );
}
