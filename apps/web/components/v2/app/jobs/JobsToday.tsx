import Link from "next/link";

import type { Job } from "@/lib/jobs/types";

import { makeT, type Words } from "../words";
import type { JobActions } from "./JobRow";
import { JobRow } from "./LazyJobRow";

/** "Running now" on Today (JOBS): what the assistant is doing for the shop, one compact row per job in ONE card: icon, name, the result line, a chip when it needs a look, and its switch. "See all jobs" opens the Jobs page. */
export function JobsToday({ jobs, words, base, actions }: { jobs: readonly Job[]; words: Words; base: string; actions: JobActions | null }) {
  const t = makeT(words);
  if (jobs.length === 0) return null;
  return (
    <section data-part="jobs-today" aria-labelledby="jobs-today-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <h2 id="jobs-today-heading" className="font-display text-xl font-semibold md:text-2xl">
          {t("jobs.today.title")}
        </h2>
        <span data-count={jobs.length} className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-2 px-2 text-sm font-bold text-ink">
          {jobs.length}
        </span>
        <Link href={`${base}/jobs`} prefetch={false} className="ml-auto inline-flex min-h-11 items-center px-1 text-sm font-semibold text-brand-text hover:underline">
          {t("jobs.today.all")}
        </Link>
      </div>
      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} words={words} base={base} actions={actions} />
        ))}
      </div>
    </section>
  );
}
