import Link from "next/link";

import type { Report } from "@/lib/api/reports";

import { say, type TodayWords } from "../today/today-words";
import { backLink } from "../ui";
import { card, field, label, primary, quiet } from "../visits/styles";
import { KpiCards, ReportTableView, SeriesBars } from "./ReportParts";

export type ReportEntry = { code: string; window: "range" | "day" | "week" };

/** The reports of the business type, as links (job CU): each is one of the closed list the API offers for the modules this business has on. The weekly summary is the page above, so it is not in this list. */
export function PackReportsList({ base, entries, words }: { base: string; entries: readonly ReportEntry[]; words: TodayWords }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="pr-h" data-part="pack-reports" className="flex flex-col gap-3">
      <div>
        <h2 id="pr-h" className="font-display text-xl font-bold">{say(words, "rep.hub.title")}</h2>
        <p className="text-sm text-muted">{say(words, "rep.hub.sub")}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        {entries.map((e) => (
          <li key={e.code}>
            <Link href={`${base}/report/${e.code}`} className={`${card} min-h-11 hover:bg-surface-2`} data-report={e.code}>
              <span className="font-display text-lg font-bold">{say(words, `rep.name.${e.code}`)}</span>
              <span className="text-sm text-muted">{say(words, `rep.window.${e.window}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SERIES_UNIT: Readonly<Record<string, "paise" | "count">> = { collection_by_day: "paise" };

/**
 * One report of the business type (job CU): the dates it covers, the figures, the tables and the bars by day, all from the one shape every pack's reports use. A range report takes a start and an end (India days, not after today);
 * a day report takes one day. The words of every figure, column and code come from the string store by key. Nothing here adds, rounds or compares: the report's own numbers are shown. Owner and Admin read.
 */
export function PackReport({ base, words, code, window, report, from, to, today, problem }: {
  base: string; words: TodayWords; code: string; window: "range" | "day" | "week"; report: Report | null; from: string | null; to: string | null; today: string; problem: boolean;
}) {
  return (
    <div data-screen="pack-report" className="flex flex-col gap-5">
      <p><Link href={`${base}/report`} className={backLink}>{say(words, "rep.back")}</Link></p>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, `rep.name.${code}`)}</h1>
        {report ? <p className="text-base text-muted" data-part="window">{report.from === report.to ? report.to : say(words, "rep.range", { from: report.from, to: report.to })}</p> : null}
      </header>
      <form method="get" action={`${base}/report/${code}`} className="flex flex-wrap items-end gap-3" aria-label={say(words, "rep.form")}>
        {window === "range" ? (
          <div>
            <label htmlFor="rr-from" className={label}>{say(words, "rep.from")}</label>
            <input id="rr-from" name="from" type="date" max={today} defaultValue={from ?? report?.from ?? ""} className={field} />
          </div>
        ) : null}
        <div>
          <label htmlFor="rr-to" className={label}>{say(words, window === "day" ? "rep.day" : "rep.to")}</label>
          <input id="rr-to" name="to" type="date" max={today} defaultValue={to ?? report?.to ?? ""} className={field} />
        </div>
        <button type="submit" className={primary}>{say(words, "rep.show")}</button>
        {from !== null || to !== null ? <Link href={`${base}/report/${code}`} className={quiet}>{say(words, "rep.reset")}</Link> : null}
      </form>
      {problem ? <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "rep.problem")}</p> : null}
      {report === null && !problem ? <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "rep.loaderr")}</p> : null}
      {report ? (
        <>
          <KpiCards kpis={report.kpis} words={words} />
          {report.tables.map((t) => <ReportTableView key={t.key} table={t} words={words} id={`rr-t-${t.key}`} />)}
          {report.series.map((s) => <SeriesBars key={s.key} series={s} words={words} unit={SERIES_UNIT[s.key] ?? "count"} id={`rr-s-${s.key}`} />)}
          <p className="text-sm text-muted">{say(words, "rep.note")}</p>
        </>
      ) : null}
    </div>
  );
}
