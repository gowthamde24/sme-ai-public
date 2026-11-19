import { Plus } from "lucide-react";
import Link from "next/link";

import { JOB_FILTERS, filterJobs, type Job, type JobFilter } from "@/lib/jobs/types";

import { makeT, type Words } from "../words";
import { JobRow, type JobActions } from "./JobRow";

const chip = "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold";

/** The Jobs page (JOBS): every job as a compact row in one card, with the filter chips (All, Running, Needs you, Paused) and "Start a job". Nothing here sends anything: a switch only stops or starts that one job. */
export function JobsList({ jobs, filter, words, base, actions }: { jobs: readonly Job[]; filter: JobFilter; words: Words; base: string; actions: JobActions | null }) {
  const t = makeT(words);
  const shown = filterJobs(jobs, filter);
  return (
    <div data-part="jobs-list" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("jobs.page.filters")} className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 py-0.5">
          {JOB_FILTERS.map((f) => (
            <Link key={f} href={f === "all" ? `${base}/jobs` : `${base}/jobs?filter=${f}`} prefetch={false} aria-current={f === filter ? "true" : undefined} className={`${chip} ${f === filter ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink"}`}>
              {t(`jobs.filter.${f}`, { n: filterJobs(jobs, f).length })}
            </Link>
          ))}
        </nav>
        <Link href={`${base}/jobs/new`} prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand">
          <Plus aria-hidden="true" className="size-4" />
          {t("jobs.page.start")}
        </Link>
      </div>
      {shown.length === 0 ? (
        <p data-empty="jobs" className="m-0 rounded-2xl border border-line bg-surface p-6 text-center text-muted">
          {t("jobs.page.empty")}
        </p>
      ) : (
        <div className="grid gap-x-4 gap-y-0 overflow-hidden rounded-2xl border border-line bg-surface md:grid-cols-2 [&>div]:border-b [&>div]:border-line">
          {shown.map((j) => (
            <JobRow key={j.id} job={j} words={words} base={base} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}
