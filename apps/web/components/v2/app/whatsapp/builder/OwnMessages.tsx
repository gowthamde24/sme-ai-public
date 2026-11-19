"use client";

import { Plus, Zap } from "lucide-react";
import Link from "next/link";
import { lazy, Suspense, useState } from "react";

import { momentText, type OwnMessage, type OwnStatus } from "@/lib/templates/types";

import { JobChip } from "../../ds/JobChip";
import { jobBtnMain, jobBtnQuiet } from "../../jobs/detail/types";
import { makeT, type Words } from "../../words";
import type { OwnMessagesProps } from "./builder-types";

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
 * "Your own messages" (Chats > Templates, JOBS): the messages the shop made in its own words, each with what WhatsApp said about it (Waiting for WhatsApp, Approved, Needs a change with the reason in plain words), and "Make a new message", which opens the builder
 * (its own lazy chunk: the Templates page loads only this list). Owner and Admin make messages; nothing here reaches a customer.
 */
export function OwnMessages({ words, items: initial, actions, secondFactor, mock, securityHref, jobsHref, lang, business }: OwnMessagesProps & { words: Words; business: string }) {
  const t = makeT(words);
  const [items, setItems] = useState<readonly OwnMessage[]>(initial);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const name = (m: OwnMessage) => (lang === "te" && m.title.te ? m.title.te : m.title.en);
  return (
    <section data-part="own-messages" aria-labelledby="own-msgs-h" className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] md:p-5">
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
          <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-48 rounded-2xl" />}>
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
            <li key={m.id} data-own={m.status} className={`rounded-2xl border p-3.5 ${m.status === "needs_change" ? "border-[var(--jb-fail-bg)]" : "border-line"}`}>
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
                  <Link href={jobsHref} prefetch={false} className={`${jobBtnQuiet} mt-2 no-underline`}>
                    <Zap aria-hidden="true" className="size-4" />
                    {t("jobs.tb.use_in_job")}
                  </Link>
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
