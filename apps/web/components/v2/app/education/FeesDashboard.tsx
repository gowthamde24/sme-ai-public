import Link from "next/link";

import type { LateFeesPreviewOut } from "@contracts/education";

import type { Report } from "@/lib/api/reports";

import { LateFeesPanel, type LateFeesAction } from "./LateFeesPanel";
import { OrbMark } from "../mark/OrbMark";
import { KpiCards, ReportTableView, SeriesBars, formatValue } from "../reports/ReportParts";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, primary, secondary } from "../visits/styles";

/**
 * The collection screen (job CS; module `fees`): how much of the fees that have FALLEN DUE has been collected, what is still pending (the word is "pending", never anything harsher), by class and section, what came in today and
 * day by day. Every figure is a sum of entries the school made (the report's own; this page adds nothing). A concession counts as settled, so the percentage can rise without money coming in. The buttons go to the pending list,
 * the fee plans and, for the Owner and Admin, a reminder campaign. A school with no plan yet is pointed at the plan first.
 */
export function FeesDashboard({ base, words, role, collection, today, plans, lateFees, postLateFees }: { base: string; words: TodayWords; role: Role; collection: Report | null; today: Report | null; plans: number | null; lateFees: LateFeesPreviewOut | null; postLateFees: LateFeesAction }) {
  const writer = role === "owner" || role === "admin";
  const noPlans = plans === 0;
  const todayCollected = today?.kpis.find((k) => k.key === "collected_paise") ?? null;
  const receipts = today?.kpis.find((k) => k.key === "receipts") ?? null;
  return (
    <div data-screen="fees" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.fees")}</h1>
          <p className="text-base text-muted">{say(words, "edu.fees.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/fees/pending`} className={primary}>{say(words, "edu.fees.pending")}</Link>
          <Link href={`${base}/fees/plans`} className={secondary}>{say(words, "edu.fees.plans")}</Link>
          {writer ? <Link href={`${base}/campaigns/new`} className={secondary}>{say(words, "edu.fees.remind")}</Link> : null}
        </div>
      </header>
      {noPlans ? (
        <div className="flex max-w-xl items-start gap-4 rounded-[20px] border border-line bg-surface p-4 md:p-5" data-part="no-plans">
          <OrbMark px={72} className="size-[72px]" />
          <div className="min-w-0">
            <p className="font-semibold">{say(words, "edu.fees.noplans.title")}</p>
            <p className="text-base text-muted">{say(words, "edu.fees.noplans.body")}</p>
            {writer ? <p className="mt-3"><Link href={`${base}/fees/plans/new`} className={primary}>{say(words, "edu.plan.add")}</Link></p> : null}
          </div>
        </div>
      ) : null}
      {collection === null ? (
        <p role="alert" className="rounded-2xl border border-line p-4 text-base">{say(words, "edu.loaderr")}</p>
      ) : (
        <>
          <p className="text-sm text-muted" data-part="window">{say(words, "edu.fees.window", { from: collection.from, to: collection.to })}</p>
          <KpiCards kpis={collection.kpis} words={words} only={["due_paise", "collected_paise", "pending_paise", "collection_pct", "concessions_paise", "students_pending"]} />
          <p className="text-sm text-muted">{say(words, "edu.fees.note")}</p>
        </>
      )}
      {today ? (
        <section className={card} aria-labelledby="fd-today" data-part="today">
          <h2 id="fd-today" className="font-display text-xl font-bold">{say(words, "edu.fees.today")}</h2>
          <p className="font-display text-3xl font-bold tabular-nums">{formatValue(todayCollected?.value ?? 0, "paise")}</p>
          <p className="text-base text-muted">{say(words, "edu.fees.receipts", { n: receipts?.value ?? 0 })}</p>
          {today.tables[0] && today.tables[0].rows.length > 0 ? <ReportTableView table={today.tables[0]} words={words} id="fd-today-t" /> : null}
        </section>
      ) : null}
      {collection ? collection.tables.map((t) => <ReportTableView key={t.key} table={t} words={words} id={`fd-t-${t.key}`} />) : null}
      {lateFees ? <LateFeesPanel preview={lateFees} canPost={writer} words={words} post={postLateFees} /> : null}
      {collection ? collection.series.map((s) => <SeriesBars key={s.key} series={s} words={words} unit="paise" id={`fd-s-${s.key}`} />) : null}
    </div>
  );
}
