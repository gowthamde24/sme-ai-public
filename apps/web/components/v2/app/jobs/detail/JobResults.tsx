"use client";

import { RESULT_TONE, whenText, type JobResultItem, type JobResults } from "@/lib/jobs/detail";
import type { JobParams } from "@/lib/jobs/types";

import { JobChip } from "../../ds/JobChip";
import type { Say } from "../../words";
import { jobCard, jobH2 } from "./types";

/** A result's sentence from its code; any number named `..._at` is a moment and is shown the way the shop says it ("Saturday, 4 pm"). */
export function detailText(t: Say, code: string, params: JobParams, lang: string): string {
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
