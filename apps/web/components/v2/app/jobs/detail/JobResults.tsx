"use client";

import { Phone, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RESULT_TONE, testWord, whenText, type JobFailure, type JobResultItem, type JobResults, type TestChannel } from "@/lib/jobs/detail";
import type { JobParams } from "@/lib/jobs/types";

import { JobChip } from "../../ds/JobChip";
import type { Say } from "../../words";
import { jobBtnQuiet, jobCard, jobH2 } from "./types";

/** A result's sentence from its code; any number named `..._at` is a moment and is shown the way the shop says it ("Saturday, 4 pm"). */
function detailText(t: Say, code: string, params: JobParams, lang: string): string {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) out[k] = k.endsWith("_at") && typeof v === "string" ? whenText(v, lang) : v;
  return t(`jobs.rd.${code}`, out);
}

/** The last days in numbers and the latest things the job did, each with one of the four solid chips. A job with nothing yet says so. */
export function ResultsCard({ results, t, lang }: { results: JobResults; t: Say; lang: string }) {
  return (
    <section data-part="job-results" className={jobCard}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={jobH2}>{t("jobs.page.results")}</h2>
        <span className="text-sm text-muted">{t("jobs.job.res.days", { n: results.days })}</span>
      </div>
      {results.numbers.length === 0 && results.items.length === 0 ? (
        <p data-empty="results" className="m-0 mt-3 text-[15px] text-muted">
          {t("jobs.job.res.none")}
        </p>
      ) : null}
      {results.numbers.length > 0 ? (
        <dl className="m-0 mt-3 grid grid-cols-3 gap-x-3 gap-y-3">
          {results.numbers.filter((n) => t(`jobs.rnum.${n.key}`) !== `jobs.rnum.${n.key}`).map((n) => (
            <div key={n.key} data-number={n.key}>
              <dd className="m-0 font-display text-[28px] font-bold leading-none text-ink">{n.value}</dd>
              <dt className="mt-1 text-[13.5px] leading-snug text-muted">{t(`jobs.rnum.${n.key}`)}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      {results.items.length > 0 ? (
        <ul className="m-0 mt-3 list-none p-0">
          {results.items.map((i: JobResultItem, idx) => (
            <li key={`${i.customer}-${idx}`} data-result={i.status} className="flex items-start justify-between gap-3 border-t border-line py-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[15px] font-semibold text-ink">{i.customer}</p>
                <p className="m-0 text-sm leading-snug text-muted">{detailText(t, i.detailCode, i.params, lang)}</p>
              </div>
              <JobChip tone={RESULT_TONE[i.status]} className="shrink-0">
                {t(`jobs.rstat.${i.status}`)}
              </JobChip>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A failed job: the reason in plain words, the people it could not reach, and the fix as a button (here: pick a template; it goes out after the owner's OK). */
export function FailureCard({ failure, fixCount, t, lang, fixHref, canChange }: { failure: JobFailure; fixCount: number; t: Say; lang: string; fixHref: string; canChange: boolean }) {
  const why = t(`jobs.fail.${failure.code}`);
  const fix = t(`jobs.fix.${failure.code}`);
  return (
    <section data-part="job-failure" className={`${jobCard} border-red-text`}>
      <p role="alert" className="m-0 rounded-xl bg-[var(--jb-fail-soft)] p-3 text-[15px] leading-snug text-ink">
        <b>{t("jobs.fail.why")}</b> {why === `jobs.fail.${failure.code}` ? t("jobs.fail.generic") : why}
      </p>
      <ul className="m-0 mt-2 list-none p-0">
        {failure.items.map((i, idx) => (
          <li key={`${i.customer}-${idx}`} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[15px] font-semibold text-ink">{i.customer}</p>
              <p className="m-0 text-sm leading-snug text-muted">{detailText(t, i.detailCode, i.params, lang)}</p>
            </div>
            {canChange ? (
              <Link href={fixHref} prefetch={false} className={`${jobBtnQuiet} shrink-0 no-underline`}>
                {fix}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {canChange && fixCount > 1 ? (
        <Link href={fixHref} prefetch={false} className="jb-press mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand no-underline md:w-auto">
          {t("jobs.fail.fix_all", { n: fixCount })}
        </Link>
      ) : null}
    </section>
  );
}

/** "Try it": a test call or message to the OWNER's own phone, never to a customer. In test mode nothing is called and the answer says so. */
export function TryCard({ channel, t, onTest }: { channel: TestChannel; t: Say; onTest: () => Promise<{ ok: boolean; text: string; quiet?: boolean }> }) {
  const [busy, setBusy] = useState(false);
  // outside 9 am to 9 pm a test is refused (`409 quiet_hours`): the button stays off from then on
  const [quiet, setQuiet] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);
  const Icon = channel === "call" ? Phone : MessageCircle;
  const word = testWord(channel);
  return (
    <section data-part="job-try" className={jobCard}>
      <p className="m-0 text-xs font-bold uppercase tracking-wider text-muted">{t("jobs.job.try")}</p>
      <p className="m-0 mt-1.5 text-[15px] leading-snug text-ink">{t(`jobs.job.try_text.${word}`)}</p>
      <button
        type="button"
        disabled={busy || quiet}
        onClick={async () => {
          setBusy(true);
          const r = await onTest();
          setAnswer(r);
          if (r.quiet) setQuiet(true);
          setBusy(false);
        }}
        className={`${jobBtnQuiet} mt-3 min-h-12 w-full`}
      >
        <Icon aria-hidden="true" className="size-[18px]" />
        {t(`jobs.job.test.${word}`)}
      </button>
      {answer ? (
        <p role={answer.ok ? "status" : "alert"} className={`m-0 mt-2 text-sm leading-snug ${answer.ok ? "text-ink" : "text-red-text"}`}>
          {answer.text}
        </p>
      ) : null}
    </section>
  );
}
