"use client";

import { Plus, Zap } from "lucide-react";
import Link from "next/link";
import { Fragment, lazy, Suspense, useState } from "react";

import { momentText, type OwnMessage, type OwnStatus } from "@/lib/templates/types";

import { JobChip } from "../../ds/JobChip";
import { jobBtnMain, jobBtnQuiet } from "../../jobs/detail/types";
import { makeT, type Words } from "../../words";
import type { BuilderActions, OwnMessagesProps, SendingJob } from "./builder-types";
import { jobNameKey, type JobKind } from "@/lib/jobs/types";

const Builder = lazy(() => import("./TemplateBuilder").then((m) => ({ default: m.TemplateBuilder })));

const TONE = { waiting: "wait", approved: "done", needs_change: "fail" } as const satisfies Record<OwnStatus, "wait" | "done" | "fail">;

/** WhatsApp's answer for a message waiting: sent, checking, answer (the middle one is where it is). */
function Track({ t }: { t: ReturnType<typeof makeT> }) {
  return (
    <ol data-part="track" className="m-0 mt-3 flex list-none items-start p-0 text-[12.5px] text-muted">
      {(["sent", "checking", "answer"] as const).map((k, i) => (
        <li key={k} className="contents">
          {i > 0 ? <span aria-hidden="true" className="mt-[5px] h-0.5 min-w-4 flex-1 bg-edge" /> : null}
          <span className="flex flex-1 flex-col items-center gap-1 text-center">
            <span aria-hidden="true" className={`size-3 rounded-full ${k === "sent" ? "bg-[var(--jb-done-bg)]" : k === "checking" ? "bg-[var(--jb-wait-bg)] ring-4 ring-[var(--jb-wait-soft)]" : "bg-edge"}`} />
            <span>{t(`jobs.tb.track.${k}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Use it in a job" on an APPROVED message: one plain sentence with the choice inside ("Let [Offers] send this message.") and a button; then what was done, with the way back to the job's standard message. With no job that may send it (or for a person who only reads)
 * it is the plain link to the Jobs page it always was. The API takes only an approved message of a kind the job sends; a "no" is a plain "That did not work. Nothing was changed".
 */
function UseInJob({ messageId, jobs, use, jobsHref, t }: { messageId: string; jobs: readonly SendingJob[]; use: NonNullable<BuilderActions["use"]> | null; jobsHref: string; t: ReturnType<typeof makeT> }) {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedIn, setUsedIn] = useState<string | null>(null);
  const nameOf = (j: SendingJob) => j.customName ?? t(jobNameKey(j.kind as JobKind));
  if (!use || jobs.length === 0) {
    return (
      <Link href={jobsHref} prefetch={false} className={`${jobBtnQuiet} mt-2 no-underline`}>
        <Zap aria-hidden="true" className="size-4" />
        {t("jobs.tb.use_in_job")}
      </Link>
    );
  }
  async function go(id: string, message: string | null) {
    setBusy(true);
    setError(null);
    const r = await use!(id, message).catch(() => null);
    setBusy(false);
    if (!r) return void setError(t("today.err.generic"));
    if (!r.ok) return void setError(r.error);
    setUsedIn(message === null ? null : id);
    if (message === null) setOpen(false);
  }
  const used = jobs.find((j) => j.id === usedIn);
  return (
    <div data-part="use-in-job" className="mt-2">
      {used ? (
        <div role="status" data-part="use-done" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-[var(--jb-done-soft)] px-3 py-2.5">
          <span className="min-w-0 text-[15px] font-semibold text-ink">{t("jobs.tb.use.done", { job: nameOf(used) })}</span>
          <button type="button" data-action="use-undo" disabled={busy} onClick={() => void go(used.id, null)} className={jobBtnQuiet}>
            {t("jobs.tb.use.undo")}
          </button>
        </div>
      ) : open ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 text-[15px] leading-snug text-ink">
          {t("jobs.tb.use.sentence")
            .split(/(\{job\})/)
            .map((part, i) =>
              part === "{job}" ? (
                <select key={i} data-part="use-job" aria-label={t("jobs.tb.use.label")} value={jobId} disabled={busy} onChange={(e) => setJobId(e.target.value)} className="min-h-11 rounded-md border border-edge bg-surface-2 px-3.5 text-[16px] font-semibold text-ink">
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {nameOf(j)}
                    </option>
                  ))}
                </select>
              ) : (
                <Fragment key={i}>{part}</Fragment>
              ),
            )}
          <button type="button" data-action="use-go" disabled={busy || jobId === ""} onClick={() => void go(jobId, messageId)} className={jobBtnMain}>
            {t("jobs.tb.use.go")}
          </button>
        </div>
      ) : (
        <button type="button" data-action="use-in-job" onClick={() => setOpen(true)} className={jobBtnQuiet}>
          <Zap aria-hidden="true" className="size-4" />
          {t("jobs.tb.use_in_job")}
        </button>
      )}
      {error ? (
        <p role="alert" data-part="use-error" className="m-0 mt-2 text-sm font-semibold text-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Your own messages" (Chats > Templates, JOBS): the messages the shop made in its own words, each with what WhatsApp said about it (Waiting for WhatsApp, Approved, Needs a change with the reason in plain words), and "Make a new message", which opens the builder
 * (its own lazy chunk: the Templates page loads only this list). Owner and Admin make messages; nothing here reaches a customer.
 */
export function OwnMessages({ words, items: initial, actions, secondFactor, mock, securityHref, jobsHref, lang, business, jobs = [] }: OwnMessagesProps & { words: Words; business: string }) {
  const t = makeT(words);
  const [items, setItems] = useState<readonly OwnMessage[]>(initial);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const name = (m: OwnMessage) => (lang === "te" && m.title.te ? m.title.te : m.title.en);
  return (
    <section data-part="own-messages" aria-labelledby="own-msgs-h" className="rounded-xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="own-msgs-h" className="m-0 font-display text-[18px] font-bold leading-tight text-ink md:text-xl">
            {t("jobs.tb.own.title")}
          </h2>
          <p className="m-0 mt-1 text-[15px] leading-snug text-muted">{t("jobs.tb.own.sub")}</p>
        </div>
        {actions && !open ? (
          <button type="button" data-action="new-message" onClick={() => (setSent(false), setOpen(true))} className={jobBtnMain}>
            <Plus aria-hidden="true" className="size-4" />
            {t("jobs.tb.new")}
          </button>
        ) : null}
      </div>
      {actions && open ? (
        <div className="mt-4 border-t border-line pt-4">
          <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-48 rounded-xl" />}>
            <Builder
              words={words}
              actions={actions}
              secondFactor={secondFactor}
              mock={mock}
              securityHref={securityHref}
              business={business}
              onClose={() => setOpen(false)}
              onSent={(m) => {
                setItems((cur) => [m, ...cur.filter((x) => x.id !== m.id)]);
                setOpen(false);
                setSent(true);
              }}
            />
          </Suspense>
        </div>
      ) : null}
      {sent ? (
        <p role="status" data-part="sent-note" className="m-0 mt-3 rounded-xl bg-[var(--jb-done-soft)] px-3 py-2.5 text-[15px] font-semibold text-ink">
          {t("jobs.tb.s5.sent")}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p data-part="own-none" className="m-0 mt-4 text-[15px] text-muted">
          {t("jobs.tb.none")}
        </p>
      ) : (
        <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
          {items.map((m) => (
            <li key={m.id} data-own={m.status} className={`rounded-xl border p-3.5 ${m.status === "needs_change" ? "border-[var(--jb-fail-bg)]" : "border-line"}`}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0">
                  <p className="m-0 text-[16px] font-bold leading-snug text-ink">{name(m)}</p>
                  <p className="m-0 text-[13px] text-muted">{t(`jobs.tb.cat.${m.category}`)}</p>
                </div>
                <JobChip tone={TONE[m.status]}>{t(`jobs.tb.status.${m.status}`)}</JobChip>
              </div>
              {m.status === "waiting" ? (
                <>
                  <p className="m-0 mt-2 text-[14.5px] leading-snug text-muted">{t("jobs.tb.sent.day", { date: momentText(m.submittedAt, lang) })}</p>
                  <Track t={t} />
                </>
              ) : null}
              {m.status === "approved" ? (
                <>
                  <p className="m-0 mt-2 text-[14.5px] leading-snug text-muted">{t("jobs.tb.approved.line")}</p>
                  <UseInJob messageId={m.id} jobs={jobs} use={actions?.use ?? null} jobsHref={jobsHref} t={t} />
                </>
              ) : null}
              {m.status === "needs_change" && m.reason ? (
                <>
                  <p data-part="reason" className="m-0 mt-2 text-[15px] leading-snug text-ink">
                    {m.reason.code === "price_or_offer" && m.reason.params.word === undefined ? t("jobs.tb.why.price_or_offer_plain") : t(`jobs.tb.why.${m.reason.code}`, { word: m.reason.params.word ?? "" })}
                  </p>
                  {actions ? (
                    <button type="button" data-action="change-it" onClick={() => (setSent(false), setOpen(true))} className={`${jobBtnMain} mt-2.5`}>
                      {t("jobs.tb.change_btn")}
                    </button>
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
