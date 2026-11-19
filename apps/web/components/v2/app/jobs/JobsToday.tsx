import Link from "next/link";

import type { Job } from "@/lib/jobs/types";

import { makeT, type Words } from "../words";
import type { JobActions } from "./JobRow";
import { JobRow } from "./LazyJobRow";
import type { FestivalHint } from "@/lib/jobs/festival";
import { FestivalSuggestion } from "./sheet/LazyFestival";
import { NewJobButton } from "./sheet/NewJobButton";
import type { SheetActions } from "./sheet/types";

/** The New job sheet's entry on Today: its actions (Owner and Admin only: null draws nothing) and the festival the assistant may suggest (null = no calendar yet or none ahead). */
export type TodaySheet = { actions: SheetActions | null; festival: FestivalHint | null };

/** "Running now" on Today (JOBS): what the assistant is doing for the shop, one compact row per job in ONE card: icon, name, the result line, a chip when it needs a look, and its switch. "See all jobs" opens the Jobs page. */
export function JobsToday({ jobs, words, base, actions, sheet = null }: { jobs: readonly Job[]; words: Words; base: string; actions: JobActions | null; sheet?: TodaySheet | null }) {
  const t = makeT(words);
  if (jobs.length === 0) return null;
  return (
    <section data-part="jobs-today" aria-labelledby="jobs-today-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <h2 id="jobs-today-heading" className="whitespace-nowrap font-display text-xl font-semibold md:text-2xl">
          {t("jobs.today.title")}
        </h2>
        <span data-count={jobs.length} className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-2 px-2 text-sm font-bold text-ink">
          {jobs.length}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {sheet?.actions ? <NewJobButton words={words} base={base} actions={sheet.actions} size="sm" /> : null}
          <Link href={`${base}/jobs`} prefetch={false} className="inline-flex min-h-11 items-center whitespace-nowrap px-1.5 text-sm font-semibold text-brand-text hover:underline">
            {t("jobs.today.all")}
          </Link>
        </span>
      </div>
      {sheet?.actions && sheet.festival ? <FestivalSuggestion festival={sheet.festival} words={words} base={base} actions={sheet.actions} /> : null}
      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} words={words} base={base} actions={actions} />
        ))}
      </div>
    </section>
  );
}
