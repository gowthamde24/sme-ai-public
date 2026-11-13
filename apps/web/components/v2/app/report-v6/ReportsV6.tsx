import { Lightbulb } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { formatRupeesShort } from "@/lib/money";
import { barWidths, buildFunnel, costResults, noResults, type SourceResult, type StageCounts } from "@/lib/reports-v6/results";
import { donutSegments, heatLevel, runningTotal } from "@/lib/reports-v6/chart-math";
import { PERIODS, periodHref, type Period, type PeriodKey } from "@/lib/reports-v6/period";
import { change, HEAT_FIRST_HOUR, HEAT_HOURS, type Change } from "@/lib/reports-v6/series";
import type { SeriesRead } from "@/app/app/tenants/[tenantId]/report/series-data";

import { dayShort } from "../visits/dates";
import { weekdayWord } from "../date-words";
import { EmptyNext } from "../ds/EmptyNext";
import { PageHeader } from "../ds/PageHeader";
import { pageMain } from "../ui";
import { makeT, type Words } from "../words";
import { EnquiryChart, PrintButton, SalesChart } from "./Lazy";

export type ReportsV6Props = {
  words: Words;
  lang: string;
  base: string;
  help: ReactNode;
  businessName: string;
  period: Period;
  /** The funnel's five steps for the period (null = could not be read). */
  counts: StageCounts;
  series: SeriesRead;
  /** The lead report's sources (enquiries, visits, what a visit cost), for "what each visit cost you". */
  sources: readonly SourceResult[];
  sourceNames: Readonly<Record<string, string>>;
  /** Where "make a plan" goes when nothing has happened yet. */
  startHref: string;
  /** The business type's own reports, drawn under the page. */
  more?: ReactNode;
  mock: boolean;
};

const card = "rounded-[18px] border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:px-[18px]";
const h3 = "m-0 font-display text-base font-extrabold";
const sub = "m-0 mb-3 mt-1 text-[12.5px] text-muted";
const SRC_COLOURS = ["var(--ds-ch-don-1)", "var(--ds-ch-don-2)", "var(--ds-ch-don-3)", "var(--ds-ch-don-4)", "var(--ds-ch-don-5)"];
const hourWord = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? "pm" : "am"}`;

/**
 * Reports of design system v6 (approved mock, owner 13 Nov 2026): the period picker and Download PDF, four figures (enquiries, visits booked, sales from visits, the cost of your assistant with the rupees per visit), the glossy "Enquiries and visits per day" chart beside "Where enquiries came from"
 * with what each visit cost, then "From enquiry to sale" with the step percentages, "Busiest times" and "Sales from visits". Rupees everywhere; no supplier and no cost of ours: "the cost of your assistant" is what the calls cost the customer (the `cost_paise` the API gives on each call). A figure the API cannot give is
 * "Not available yet", never made up. The charts are SVG in a lazy chunk with their numbers in tables for screen readers; the rest is drawn on the server.
 */
export function ReportsV6({ words, lang, base, help, businessName, period, counts, series, sources, sourceNames, startHref, more = null, mock }: ReportsV6Props) {
  const t = makeT(words);
  const name = (s: string): string => sourceNames[s] ?? (s === "other" ? t("rv6.src.other") : s.replace(/_/g, " "));
  const emptyHeader = <PageHeader title={t("rv6.title")} sub={t("rv6.sub2", { business: businessName })} right={help} />;
  const sourcesList = series.enquiries ? series.enquiries.sources : sources.filter((s) => s.enquiries > 0).map((s) => ({ source: s.source, count: s.enquiries }));
  if (noResults(counts, sources) && (series.enquiries?.total ?? 0) === 0 && (series.visits?.total ?? 0) === 0) {
    return (
      <main className={pageMain} lang={lang} data-part="reports-v6">
        {emptyHeader}
        <div className="mt-8">
          <EmptyNext title={t("rv6.empty.title")} text={t("rv6.empty.text")} action={{ href: startHref, label: t("rv6.empty.action") }} />
        </div>
        {more ? <div className="mt-8">{more}</div> : null}
      </main>
    );
  }
  const days = period.days;
  const labels = days.map((d) => ({ axis: String(Number(d.slice(8))), full: dayShort(d, lang) }));
  const vs = t(period.key === "14" ? "rv6.vs.14" : period.key === "today" ? "rv6.vs.today" : "rv6.vs.other");
  const arrow = (c: Change) => (c.dir === "up" ? "▲" : c.dir === "down" ? "▼" : "•");
  const delta = (c: Change, text: string, extra = true) => (
    <em className={`m-0 text-[12.5px] font-bold not-italic ${c.dir === "down" ? "text-red-text" : c.dir === "up" ? "text-green-text" : "text-muted"}`}>
      {arrow(c)} {text}
      {extra ? ` ${vs}` : ""}
    </em>
  );
  const e = series.enquiries;
  const v = series.visits;
  const s = series.sales;
  const cost = series.callCostPaise;
  const na = <em className="text-[12.5px] not-italic text-muted">{t("rv6.na")}</em>;
  const kpi = (id: string, label: string, value: string | null, note: ReactNode) => (
    <li key={id} data-kpi={id} className="rounded-[18px] border border-line bg-surface px-4 py-3.5 shadow-[var(--v2-shadow)]">
      <p className="m-0 text-[12.5px] text-muted">{label}</p>
      <p className="m-0 mb-0.5 mt-1 font-display text-[28px] font-extrabold leading-tight tracking-tight tabular-nums sm:text-[30px]">{value ?? "–"}</p>
      {value === null ? na : note}
    </li>
  );
  const eChange = e ? change(e.total, e.previous) : null;
  const vChange = v ? change(v.total, v.previous) : null;
  const sChange = s ? change(s.total, s.previous) : null;
  const total = (n: number | undefined) => (n ?? 0).toLocaleString("en-IN");
  const periodTabs = PERIODS.filter((k) => k !== "custom").map((k) => ({ key: k, label: t(`rv6.per.${k}`), href: periodHref(base, k) }));

  const control = (
    <>
      {help}
      <div className="flex flex-wrap items-center gap-2" data-part="period">
        <nav aria-label={t("rv6.range.label")} className="max-w-full overflow-x-auto">
          <ul className="m-0 flex list-none gap-0 rounded-xl border border-line bg-surface p-[3px]">
            {periodTabs.map((p) => (
              <li key={p.key}>
                <Link href={p.href} aria-current={period.key === p.key ? "page" : undefined} data-period={p.key} className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-[9px] px-3 text-[13px] ${period.key === p.key ? "bg-ink font-bold text-bg" : "text-muted hover:bg-surface-2"}`}>
                  {p.label}
                </Link>
              </li>
            ))}
            <li>
              <details key={`${period.key}-${period.from}-${period.to}`} className="relative" data-period="custom">
                <summary className={`inline-flex min-h-11 cursor-pointer list-none items-center whitespace-nowrap rounded-[9px] px-3 text-[13px] [&::-webkit-details-marker]:hidden ${period.key === "custom" ? "bg-ink font-bold text-bg" : "text-muted hover:bg-surface-2"}`}>{t("rv6.per.custom")}</summary>
                <form action={`${base}/report`} method="get" className="absolute right-0 z-20 mt-2 flex w-64 flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-[var(--v2-shadow-pop)]">
                  <input type="hidden" name="range" value="custom" />
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    {t("rv6.per.from")}
                    <input type="date" name="from" defaultValue={period.from} className="min-h-11 rounded-lg border border-edge bg-surface px-2 text-base font-normal" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    {t("rv6.per.to")}
                    <input type="date" name="to" defaultValue={period.to} className="min-h-11 rounded-lg border border-edge bg-surface px-2 text-base font-normal" />
                  </label>
                  <button type="submit" className="min-h-11 rounded-[9px] bg-brand px-3 text-[13px] font-bold text-on-brand">
                    {t("rv6.per.apply")}
                  </button>
                </form>
              </details>
            </li>
          </ul>
        </nav>
        <PrintButton label={t("rv6.pdf")} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-surface-2" />
      </div>
    </>
  );
  const heading = <PageHeader title={t("rv6.title")} sub={t("rv6.sub2", { business: businessName })} right={control} />;

  // the funnel
  const funnel = buildFunnel(counts);
  const widths = barWidths(funnel.map((f) => f.value));

  // the donut
  const donutTotal = sourcesList.reduce((n, x) => n + x.count, 0);
  const top = sourcesList.slice(0, 4);
  const rest = sourcesList.slice(4).reduce((n, x) => n + x.count, 0);
  const donut = [...top.map((x) => ({ label: name(x.source), count: x.count })), ...(rest > 0 ? [{ label: t("rv6.src.rest"), count: rest }] : [])];
  const segs = donutSegments(donut.map((x) => x.count), 74);
  const costs = costResults(sources);

  // the heatmap
  const heat = series.heat;
  const heatOk = heat !== null && heat.total >= 5;
  const tip = heat?.busiest ? t("rv6.heat.tip", { day: weekdayWord(lang, heat.busiest.weekday), from: hourWord(heat.busiest.fromHour), to: hourWord(heat.busiest.toHour) }) : null;

  // the sales line
  const salesTotals = s ? runningTotal(s.perDay) : [];

  return (
    <main className={pageMain} lang={lang} data-part="reports-v6">
      {heading}
      {mock ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {t("rv6.mock")}
        </p>
      ) : null}
      {series.capped ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {t("rv6.capped")}
        </p>
      ) : null}

      <ul data-part="tiles" className="m-0 mt-4 grid list-none grid-cols-1 gap-3.5 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {kpi("enquiries", t("rv6.kpi.enquiries"), e ? total(e.total) : null, eChange ? delta(eChange, eChange.percent !== null ? `${eChange.percent}%` : String(eChange.diff)) : null)}
        {kpi("visits", t("rv6.kpi.visits"), v ? total(v.total) : null, vChange ? delta(vChange, String(vChange.diff), false) : null)}
        {kpi("sales", t("rv6.kpi.sales"), s ? formatRupeesShort(s.total) : null, sChange ? delta(sChange, formatRupeesShort(sChange.diff), false) : null)}
        {kpi("cost", t("rv6.kpi.cost"), cost !== null ? formatRupeesShort(cost) : null, <em className="text-[12.5px] not-italic text-muted">{v && v.total > 0 && cost !== null ? t("rv6.kpi.perVisit", { amount: formatRupeesShort(Math.round(cost / 100 / v.total) * 100) }) : t("rv6.kpi.costNote")}</em>)}
      </ul>

      <div className="mt-4 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="rv6-chart" data-part="chart" className={`${card} min-w-0`}>
          <h2 id="rv6-chart" className={h3}>
            {t("rv6.chart.title")}
          </h2>
          <p className={sub}>{t("rv6.chart.sub")}</p>
          <p className="m-0 mb-1.5 flex gap-3.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px] bg-gradient-to-r from-[var(--ds-ch-enq-1)] to-[var(--ds-ch-enq-3)]" />
              {t("rv6.chart.enq")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px] bg-[var(--ds-ch-vis-2)]" />
              {t("rv6.chart.vis")}
            </span>
          </p>
          {e && v ? (
            <>
              <EnquiryChart
                labels={labels}
                enquiries={e.perDay}
                visits={v.perDay}
                summary={t("rv6.chart.summary", { e: e.total, v: v.total, n: days.length })}
                tips={labels.map((l, i) => ({ title: l.full, enquiries: t("rv6.tip.enq", { n: e.perDay[i] }), visits: t("rv6.tip.vis", { n: v.perDay[i] }) }))}
              />
              <table className="sr-only">
                <caption>{t("rv6.chart.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("rv6.chart.day")}</th>
                    <th scope="col">{t("rv6.chart.enq")}</th>
                    <th scope="col">{t("rv6.chart.vis")}</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={d}>
                      <th scope="row">{labels[i].full}</th>
                      <td>{e.perDay[i]}</td>
                      <td>{v.perDay[i]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="m-0 py-10 text-center text-base text-muted">{t("rv6.na")}</p>
          )}
        </section>

        <section aria-labelledby="rv6-src" data-part="sources" className={`${card} min-w-0`}>
          <h2 id="rv6-src" className={h3}>
            {t("rv6.src.title")}
          </h2>
          <p className={sub}>{t("rv6.src.sub")}</p>
          {donutTotal === 0 ? (
            <p className="m-0 text-base text-muted">{t("rv6.src.none")}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-[18px]">
              <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label={t("rv6.src.title")} className="shrink-0">
                <g transform="rotate(-90 90 90)">
                  <circle cx="90" cy="90" r="74" fill="none" stroke="var(--v2-border)" strokeWidth="22" opacity=".5" />
                  {segs.map((g, i) => (g.dash > 0 ? <circle key={i} cx="90" cy="90" r="74" fill="none" stroke={SRC_COLOURS[i % SRC_COLOURS.length]} strokeWidth="22" strokeDasharray={`${g.dash} ${g.rest}`} strokeDashoffset={g.offset} /> : null))}
                </g>
                <text x="90" y="86" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--v2-ink)" className="font-display">
                  {donutTotal}
                </text>
                <text x="90" y="106" textAnchor="middle" fontSize="12" fill="var(--v2-muted)">
                  {t("rv6.src.center")}
                </text>
              </svg>
              <ul className="m-0 flex min-w-40 flex-1 list-none flex-col gap-2 p-0 text-[13px]">
                {donut.map((x, i) => (
                  <li key={x.label} data-source={x.label} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2.5">
                    <i aria-hidden="true" className="ds-sw inline-block size-2.5 rounded-[3px]" data-sw={i} />
                    <span className="min-w-0 break-words">{x.label}</span>
                    <b className="tabular-nums">{x.count}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {costs.length > 0 ? (
            <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 border-t border-line p-0 pt-3 text-[12.5px]" data-part="cost-per-visit">
              {costs.map((c) => (
                <li key={c.source} className="flex justify-between gap-3">
                  <span className="text-muted">{name(c.source)}</span>
                  <b>{c.paise === 0 ? t("rv6.src.free") : t("rv6.src.perVisit", { amount: formatRupeesShort(c.paise) })}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <section aria-labelledby="rv6-funnel" data-part="funnel" className={`${card} min-w-0`}>
          <h2 id="rv6-funnel" className={h3}>
            {t("rv6.funnel.title")}
          </h2>
          <p className={sub}>{t("rv6.funnel.sub")}</p>
          <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
            <defs>
              <linearGradient id="rv6-fg" x1="0" x2="1">
                <stop offset="0" stopColor="var(--ds-ch-enq-1)" />
                <stop offset="1" stopColor="var(--ds-ch-don-1)" />
              </linearGradient>
              <linearGradient id="rv6-fw" x1="0" x2="1">
                <stop offset="0" stopColor="var(--ds-ch-won-1)" />
                <stop offset="1" stopColor="var(--ds-ch-won)" />
              </linearGradient>
            </defs>
          </svg>
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
            {funnel.map((f, i) =>
              f.value === null ? (
                <li key={f.id} data-stage={f.id} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2.5 py-[7px] text-[13px] text-muted">
                  <span>{t(`rv6.stage.${f.id}`)}</span>
                  <span>{t("rv6.stage.unknown")}</span>
                </li>
              ) : (
                <li key={f.id} data-stage={f.id} data-bar={widths[i]} className="grid grid-cols-[96px_minmax(0,1fr)_34px_40px] items-center gap-2.5 py-[7px] text-[13px]">
                  <span className="text-muted">{t(`rv6.stage.${f.id}`)}</span>
                  <svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true" focusable="false" className="h-[22px] w-full">
                    <rect width="100" height="22" rx="4" fill="var(--v2-bg)" />
                    {widths[i] > 0 ? <rect width={widths[i]} height="22" rx="4" fill={f.id === "won" ? "url(#rv6-fw)" : "url(#rv6-fg)"} /> : null}
                  </svg>
                  <b className="text-right tabular-nums">{f.value}</b>
                  <em className="text-right text-[11.5px] not-italic text-muted">{f.previous !== null && f.previous > 0 ? `${Math.round((f.value / f.previous) * 100)}%` : ""}</em>
                </li>
              ),
            )}
          </ol>
        </section>

        <section aria-labelledby="rv6-heat" data-part="heatmap" className={`${card} min-w-0`}>
          <h2 id="rv6-heat" className={h3}>
            {t("rv6.heat.title")}
          </h2>
          <p className={sub}>{t("rv6.heat.sub")}</p>
          {heatOk && heat ? (
            <>
              <div role="img" aria-label={t("rv6.heat.title")} className="flex flex-col gap-1">
                {heat.grid.map((row, wd) => (
                  <div key={wd} className="grid grid-cols-[34px_repeat(12,minmax(0,1fr))] items-center gap-1">
                    <span className="text-[11.5px] text-muted">{weekdayWord(lang, wd, "short")}</span>
                    {row.map((c, h) => (
                      <i key={h} data-l={heatLevel(c, heat.max)} title={`${weekdayWord(lang, wd)} ${hourWord(HEAT_FIRST_HOUR + h)}: ${c}`} className="ds-heat block h-5 rounded-[5px]" />
                    ))}
                  </div>
                ))}
                <div className="grid grid-cols-[34px_repeat(12,minmax(0,1fr))] gap-1" aria-hidden="true">
                  <span />
                  {Array.from({ length: HEAT_HOURS }, (_, h) => (
                    <em key={h} className="text-center text-[10.5px] not-italic text-muted">
                      {(HEAT_FIRST_HOUR + h) % 12 || 12}
                    </em>
                  ))}
                </div>
              </div>
              <p className="m-0 mt-2 text-xs text-muted">{t("rv6.heat.from", { n: heat.total })}</p>
              {tip ? (
                <p className="m-0 mt-2.5 flex items-start gap-2.5 rounded-xl bg-brand-bg px-3 py-2.5 text-[13px] leading-[1.45]" data-part="heat-tip">
                  <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-text" />
                  <span>{tip}</span>
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-base text-muted" data-part="heat-none">
              {heat === null ? t("rv6.na") : t("rv6.heat.few")}
            </p>
          )}
        </section>

        <section aria-labelledby="rv6-sales" data-part="sales" className={`${card} min-w-0`}>
          <h2 id="rv6-sales" className={h3}>
            {t("rv6.sales.title")}
          </h2>
          <p className={sub}>{t("rv6.sales.sub")}</p>
          {s === null ? (
            <p className="m-0 text-base text-muted">{t("rv6.na")}</p>
          ) : (
            <>
              <p className="m-0 font-display text-[28px] font-extrabold tracking-tight tabular-nums">{formatRupeesShort(s.total)}</p>
              {s.total === 0 && s.missing === 0 ? <p className="m-0 mt-1 text-sm text-muted">{t("rv6.sales.none")}</p> : null}
              <SalesChart labels={labels} totals={salesTotals} summary={t("rv6.sales.summary", { amount: formatRupeesShort(s.total) })} />
              {s.missing > 0 ? <p className="m-0 mt-2 text-xs text-muted">{t("rv6.sales.missing", { n: s.missing })}</p> : null}
            </>
          )}
        </section>
      </div>
      <p className="mt-4 text-sm text-muted">
        <Link href={`${base}/outreach`} className="font-semibold text-brand-text underline">
          {t("rv6.link.campaigns")}
        </Link>
        {/* the other two report pages (owner, 13 Nov 2026: one tab row at most, and Reports has the period row): reached from here, not from a second row of tabs */}
        {[
          ["lead-report", "leadreport"],
          ["everything", "everything"],
        ].map(([path, key]) => (
          <Fragment key={key}>
            <span aria-hidden="true"> · </span>
            <Link href={`${base}/${path}`} className="font-semibold text-brand-text underline">
              {t(`nav.item.${key}`)}
            </Link>
          </Fragment>
        ))}
      </p>
      {more ? <div className="mt-8">{more}</div> : null}
    </main>
  );
}
