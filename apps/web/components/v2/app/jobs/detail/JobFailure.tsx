"use client";

import Link from "next/link";

import type { JobFailure } from "@/lib/jobs/detail";

import type { Say } from "../../words";
import { detailText } from "./JobResults";
import { jobBtnQuiet, jobCard } from "./types";

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
        <Link href={fixHref} prefetch={false} className="jb-press mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand no-underline md:w-auto">
          {t("jobs.fail.fix_all", { n: fixCount })}
        </Link>
      ) : null}
    </section>
  );
}
