import { Ban, Plus } from "lucide-react";
import Link from "next/link";

import type { Suggestion } from "@/lib/jobs/plan";
import type { SheetLoad } from "@/lib/jobs/templates";
import { JOB_FILTERS, filterJobs, jobState, type Job, type JobFilter } from "@/lib/jobs/types";

import { makeT, type Words } from "../words";
import { JobLine } from "./JobLine";
import type { JobActions } from "./JobRow";
import { SuggestedJobs, type SuggestionActions } from "./SuggestedJobs";
import { JobsEmpty } from "./sheet/LazyJobsEmpty";
import { NewJobButton } from "./sheet/NewJobButton";
import type { SheetActions } from "./sheet/types";
import { cardBox } from "../Card";

const chip = "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md border px-3.5 text-sm font-semibold";

/** The New job sheet on the Jobs page: its actions (Owner and Admin; null = no button), the ideas the server already read (for the empty page and for `?new=1`) and whether the page was opened with the sheet open. */
export type JobsSheet = { actions: SheetActions | null; load: SheetLoad | null; open: boolean };

/** The three groups of the list (mock r3-07): what needs the owner first, then what is running, then what is off. */
const GROUPS = ["needs", "running", "off"] as const;
type Group = (typeof GROUPS)[number];
const groupOf = (j: Job): Group => jobState(j);

/**
 * The Jobs page (JOBS; the renamed Office): every job as a compact row in one card, grouped Needs you, Running, Off, with the filter chips (All, Running, Needs you, Off), "New job" and the Do-Not-Call link. A job the owner named shows its own voice, language and
 * number as chips. There is no fixed number of jobs. Without `sheet` (the Start a job page flow) "New job" is the old link to that page. Nothing here sends anything: a switch only stops or starts that one job.
 */
export function JobsList({ jobs, filter, words, base, actions, suggestions = [], suggestionActions = null, sheet = null, tellHref = null }: { jobs: readonly Job[]; filter: JobFilter; words: Words; base: string; actions: JobActions | null; suggestions?: readonly Suggestion[]; suggestionActions?: SuggestionActions | null; sheet?: JobsSheet | null; /** "+ Tell your assistant what to do" (TELL_SCREENS): the address of the screen, or null = no link */ tellHref?: string | null }) {
  const t = makeT(words);
  const shown = filterJobs(jobs, filter);
  const grouped = filter === "all" ? GROUPS.map((g) => ({ g, rows: shown.filter((j) => groupOf(j) === g) })).filter((x) => x.rows.length > 0) : [{ g: null, rows: shown }];
  const rowOf = (j: Job) => <JobLine key={j.id} job={j} words={words} base={base} actions={actions} />;
  return (
    <div data-part="jobs-list" className="flex flex-col gap-4">
      {tellHref ? (
        <p className="m-0">
          <Link href={tellHref} prefetch={false} data-part="tell-link" className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline underline-offset-4">
            {t("jobs.tell.link")}
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("jobs.page.filters")} className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 py-0.5">
          {JOB_FILTERS.map((f) => (
            <Link key={f} href={f === "all" ? `${base}/jobs` : `${base}/jobs?filter=${f}`} prefetch={false} aria-current={f === filter ? "true" : undefined} className={`${chip} ${f === filter ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink"}`}>
              {t(`jobs.filter.${f}`, { n: filterJobs(jobs, f).length })}
            </Link>
          ))}
        </nav>
        {sheet ? (
          <NewJobButton words={words} base={base} actions={sheet.actions} initial={sheet.load ?? undefined} defaultOpen={sheet.open && sheet.actions !== null} />
        ) : (
          <Link href={`${base}/jobs/new`} prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand">
            <Plus aria-hidden="true" className="size-4" />
            {t("jobs.page.start")}
          </Link>
        )}
      </div>
      {jobs.length === 0 && sheet?.actions && sheet.load && sheet.load.data.own.templates.length > 0 ? (
        <JobsEmpty words={words} base={base} actions={sheet.actions} load={sheet.load} />
      ) : jobs.length === 0 && suggestions.length > 0 ? (
        <section data-empty="jobs" data-part="jobs-empty" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 md:p-6">
          <div className="text-center">
            <h2 className="m-0 font-display text-[20px] font-bold text-ink">{t("jobs.new.empty.title")}</h2>
            <p className="m-0 mx-auto mt-1 max-w-xl text-[14px] leading-snug text-muted">{t("jobs.new.empty.sub")}</p>
          </div>
          <SuggestedJobs suggestions={suggestions} words={words} base={base} actions={suggestionActions} compact />
          <Link href={`${base}/jobs/new`} prefetch={false} data-part="say-instead" className="flex min-h-12 items-center rounded-md border border-edge bg-surface px-5 text-[15px] text-muted no-underline">
            {t("jobs.new.empty.say")}
          </Link>
        </section>
      ) : shown.length === 0 ? (
        <p data-empty="jobs" className="m-0 rounded-xl border border-line bg-surface p-6 text-center text-muted">
          {t(filter === "needs_you" && jobs.length > 0 ? "jobs.page.empty.needs" : "jobs.page.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map(({ g, rows }) => (
            <section key={g ?? "rows"} data-group={g ?? undefined} aria-label={g ? t(`jobs.page.group.${g}`) : undefined} className="flex flex-col">
              {g ? (
                <h2 className="m-0 mb-2 text-[15px] font-semibold text-muted">
                  {t(`jobs.page.group.${g}`)} <span className="font-normal">{rows.length}</span>
                </h2>
              ) : null}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-part="job-grid">{rows.map(rowOf)}</div>
            </section>
          ))}
        </div>
      )}
      <Link href={`${base}/do-not-call`} prefetch={false} data-part="dnc-link" className={`${cardBox} flex min-h-14 items-center gap-3 no-underline`}>
        <Ban aria-hidden="true" className="size-[18px] shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug text-ink">{t("jobs.page.dnc.title")}</span>
          <span className="block text-[14px] leading-snug text-muted">{t("jobs.page.dnc.sub")}</span>
        </span>
      </Link>
    </div>
  );
}
