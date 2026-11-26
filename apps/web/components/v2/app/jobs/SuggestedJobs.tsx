"use client";

import { Gift, MessageCircle, Phone, Search, Sparkles, Store, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ApprovalKind, JobStarted, Suggestion } from "@/lib/jobs/plan";
import { jobNameKey, type JobKind } from "@/lib/jobs/types";

import { JobChip } from "../ds/JobChip";
import type { Reply } from "../cc/kit";
import { makeT, type Words } from "../words";
import { waitingText } from "./waiting-text";
import { StartedToast } from "./StartedToast";

const ICON: Record<JobKind, typeof Zap> = { speed_to_lead: Zap, answer_calls: Phone, followups: MessageCircle, store_visits: Store, offers: Gift, researcher: Search, payment_reminders: Wallet, custom: Sparkles };

export type SuggestionActions = { start: (kind: JobKind) => Promise<Reply<JobStarted>> };

/**
 * The suggested jobs for the business type (mock sheet 03; 9 "No jobs yet"): 3-4 pre-filled cards, each with why it fits (the shop's own numbers), a preview of what it says, Start (one tap) and Look first (the same plan card). No gallery, no browsing.
 * `onLook` opens the plan card on the page that has it; without it (the empty Jobs page) Look first is a link to that page. `compact` = the empty state's rows (title, why, Start).
 */
export function SuggestedJobs({ suggestions, words, base, actions, onLook, compact = false }: { suggestions: readonly Suggestion[]; words: Words; base: string; actions: SuggestionActions | null; onLook?: (kind: JobKind) => void; compact?: boolean }) {
  const t = makeT(words);
  const router = useRouter();
  const [busy, setBusy] = useState<JobKind | null>(null);
  const [error, setError] = useState<{ kind: JobKind; text: string } | null>(null);
  const [started, setStarted] = useState(false);
  // jobs whose start answered `409 approval_needed`: the Owner's OK is asked first (it is in Needs you on Today)
  const [waiting, setWaiting] = useState<readonly { kind: JobKind; approval: ApprovalKind }[]>([]);

  async function start(kind: JobKind) {
    if (!actions || busy) return;
    setBusy(kind);
    setError(null);
    const r = await actions.start(kind);
    if (!r.ok) {
      setBusy(null);
      setError({ kind, text: r.error });
      return;
    }
    if ("approval" in r.data) {
      const approval = r.data.approval.kind;
      setBusy(null);
      setWaiting((w) => [...w, { kind, approval }]);
      return;
    }
    setStarted(true);
    router.push(`${base}/jobs/${r.data.jobId}?started=1`);
  }

  const ghost = "jb-press inline-flex min-h-10 items-center justify-center rounded-md border border-edge bg-surface px-4 text-[15px] font-semibold text-ink";
  return (
    <>
      <ul data-part="suggestions" className="m-0 flex list-none flex-col gap-2.5 p-0 md:gap-3">
        {suggestions.map((s) => {
          const Icon = ICON[s.kind];
          const title = s.title && words[`jobs.new.title.${s.title.code}`] ? t(`jobs.new.title.${s.title.code}`) : t(jobNameKey(s.kind));
          const isBusy = busy === s.kind;
          const waitingFor = waiting.find((w) => w.kind === s.kind) ?? null;
          const isWaiting = waitingFor !== null;
          return (
            <li key={s.kind} data-suggestion={s.kind} className="rounded-xl border border-line bg-surface p-3.5 md:p-4">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand-text">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 font-display text-[16px] font-bold leading-snug text-ink">{title}</h3>
                  <p className="m-0 mt-0.5 text-[13.5px] leading-snug text-muted">{t(`jobs.new.why.${s.why.code}`, s.why.params as Record<string, string | number>)}</p>
                  {compact ? (
                    <Link href={`${base}/jobs/new?look=${s.kind}`} prefetch={false} data-action="look" className="-mb-2 mt-0.5 inline-flex min-h-11 items-center text-[14px] font-semibold text-brand-text underline underline-offset-4">
                      {t("jobs.new.sug.look")}
                    </Link>
                  ) : null}
                </div>
                {compact ? (
                  <button type="button" data-action="start" disabled={!actions || busy !== null || !s.ready || isWaiting} onClick={() => void start(s.kind)} className="jb-press inline-flex min-h-10 shrink-0 items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand disabled:opacity-60">
                    {t("jobs.new.start")}
                  </button>
                ) : null}
              </div>
              {!compact ? (
                <>
                  <p data-part="suggestion-says" className="m-0 mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[14px] leading-snug text-ink">
                    <span className="text-muted">{t("jobs.new.sug.says")}</span> {`“${s.preview}”`}
                  </p>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
                    <button type="button" data-action="start" disabled={!actions || busy !== null || !s.ready || isWaiting} onClick={() => void start(s.kind)} className="jb-press inline-flex min-h-11 items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand disabled:opacity-60">
                      {isBusy ? t("jobs.new.starting") : t("jobs.new.start")}
                    </button>
                    {onLook ? (
                      <button type="button" data-action="look" onClick={() => onLook(s.kind)} disabled={busy !== null} className={`${ghost} min-h-11`}>
                        {t("jobs.new.sug.look")}
                      </button>
                    ) : (
                      <Link href={`${base}/jobs/new?look=${s.kind}`} prefetch={false} data-action="look" className={`${ghost} min-h-11 no-underline`}>
                        {t("jobs.new.sug.look")}
                      </Link>
                    )}
                  </div>
                </>
              ) : null}
              {isWaiting ? (
                <div data-part="suggestion-waiting" role="status" className="mt-2.5 flex flex-col gap-1 rounded-xl bg-surface-2 p-3">
                  <JobChip tone="wait" className="self-start">
                    {waitingFor ? waitingText(t, waitingFor.approval) : null}
                  </JobChip>
                  <p className="m-0 text-[14px] leading-snug text-ink">{t("jobs.new.waiting.sub")}</p>
                  <Link href={`${base}#needs-you`} prefetch={false} data-action="see-needs-you" className="-mb-1 inline-flex min-h-11 items-center text-[15px] font-semibold text-brand-text underline underline-offset-4">
                    {t("jobs.new.waiting.link")}
                  </Link>
                </div>
              ) : null}
              {error?.kind === s.kind ? (
                <p role="alert" className="m-0 mt-2 text-sm text-red-text">
                  {error.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {started ? <StartedToast label={t("jobs.new.started")} /> : null}
    </>
  );
}
