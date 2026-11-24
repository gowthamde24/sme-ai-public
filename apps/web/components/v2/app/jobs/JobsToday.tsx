import Link from "next/link";

import { jobState, type Job } from "@/lib/jobs/types";

import { MessageSquareWarning } from "lucide-react";

import { makeT, type Words } from "../words";
import type { JobActions } from "./JobRow";
import { JobRow } from "./LazyJobRow";
import { JobLine } from "./LazyJobLine";
import type { FestivalHint } from "@/lib/jobs/festival";
import { FestivalSuggestion } from "./sheet/LazyFestival";
import { NewJobButton } from "./sheet/NewJobButton";
import type { SheetActions } from "./sheet/types";

/** The New job sheet's entry on Today: its actions (Owner and Admin only: null draws nothing) and the festival the assistant may suggest (null = no calendar yet or none ahead). */
export type TodaySheet = { actions: SheetActions | null; festival: FestivalHint | null };

/** "Running now" on Today (JOBS): what the assistant is doing for the shop, one compact row per job in ONE card: icon, name, the result line, a chip when it needs a look, and its switch. "See all jobs" opens the Jobs page. */
export function JobsToday({ jobs, words, base, actions, sheet = null, messagesToChange = 0, open = false }: { jobs: readonly Job[]; words: Words; base: string; actions: JobActions | null; sheet?: TodaySheet | null; /** TODAY_OPEN: hairline rows with bare category icons (JobLine), no card around the list. */ open?: boolean; /** How many of the shop's own messages WhatsApp sent back (the Needs-you code `message_needs_change`): one row that opens Chats > Templates. */ messagesToChange?: number }) {
  const t = makeT(words);
  if (jobs.length === 0) return null;
  // the count is the number of jobs that really run now (not the number of job types): the others (waiting for the owner, paused) are listed under their own grey line
  const running = jobs.filter((j) => jobState(j) === "running");
  const others = jobs.filter((j) => jobState(j) !== "running");
  return (
    <section data-part="jobs-today" aria-labelledby="jobs-today-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 id="jobs-today-heading" className="whitespace-nowrap font-display text-xl font-semibold md:text-2xl">
          {t("jobs.today.title")}
        </h2>
        <span data-count={running.length} className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-2 px-2 text-sm font-bold text-ink">
          {running.length}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {sheet?.actions ? <NewJobButton words={words} base={base} actions={sheet.actions} size="sm" /> : null}
          <Link href={`${base}/jobs`} prefetch={false} className="inline-flex min-h-11 items-center whitespace-nowrap px-1.5 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
            {t("jobs.today.all")}
          </Link>
        </span>
      </div>
      {messagesToChange > 0 ? (
        <Link href={`${base}/chats/templates`} prefetch={false} data-part="need-message" data-count={messagesToChange} className="jb-press flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--jb-fail-bg)] bg-surface px-4 py-3 no-underline">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--jb-fail-soft)] text-ink">
            <MessageSquareWarning className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-ink">{messagesToChange === 1 ? t("jobs.tb.need.one") : t("jobs.tb.need.n", { n: messagesToChange })}</span>
            <span className="block text-[14px] leading-snug text-muted">{t("jobs.tb.need.sub")}</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-brand-text">{t("jobs.tb.need.open")}</span>
        </Link>
      ) : null}
      {sheet?.actions && sheet.festival ? <FestivalSuggestion festival={sheet.festival} words={words} base={base} actions={sheet.actions} /> : null}
      {open ? (
        <div data-part="jobs-open" className="grid grid-cols-1 gap-3">
          {running.map((j) => (
            <JobLine key={j.id} job={j} words={words} base={base} actions={actions} />
          ))}
          {others.length > 0 ? (
            <p data-part="jobs-others" className="m-0 pt-1 text-[15px] text-muted">
              {t("jobs.today.others")}
            </p>
          ) : null}
          {others.map((j) => (
            <JobLine key={j.id} job={j} words={words} base={base} actions={actions} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} words={words} base={base} actions={actions} />
          ))}
        </div>
      )}
    </section>
  );
}
