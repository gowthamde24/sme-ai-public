import Link from "next/link";
import type { ReactNode } from "react";

import { formatRupeesShort } from "@/lib/money";
import { barWidths, buildFunnel, costResults, noResults, RANGES, type RangeKey, type SourceResult, type StageCounts } from "@/lib/reports-v6/results";

import { EmptyNext } from "../ds/EmptyNext";
import { PageHeader } from "../ds/PageHeader";
import { pageMain } from "../ui";
import { ChipBar } from "../v6/ChipBar";
import { HBar } from "../v6/HBar";
import { card, sectionTitle } from "../v6/ui";
import { makeT, type Words } from "../words";

export type ReportsV6Props = {
  words: Words;
  lang: string;
  base: string;
  help: ReactNode;
  range: RangeKey;
  rangeHref: (key: RangeKey) => string;
  counts: StageCounts;
  /** What the live quotes of the range add up to, in paise; null when quotes could not be read. */
  quotesPaise: number | null;
  sources: readonly SourceResult[];
  /** What a visit cost in all, in paise; null when no visit was booked. */
  costPerVisitPaise: number | null;
  sourceNames: Readonly<Record<string, string>>;
  /** Where "make a plan" goes when nothing has happened yet. */
  startHref: string;
  /** The business type's own reports (the old "More reports" list), drawn under the three sections. */
  more?: ReactNode;
  mock: boolean;
};

/**
 * Reports of design system v6 (owner 13 Nov 2026): results first. Three tiles (visits booked, quotes in rupees, won), then ONE chart per section: the funnel from enquiry to sale, the sources that brought visits, and what a visit cost in rupees. No count of
 * activity on its own (calls made, messages sent) appears anywhere. Every chart is rows of words and numbers with a thin SVG bar beside them, so the numbers are always readable as text.
 */
export function ReportsV6({ words, lang, base, help, range, rangeHref, counts, quotesPaise, sources, costPerVisitPaise, sourceNames, startHref, more = null, mock }: ReportsV6Props) {
  const t = makeT(words);
  const name = (s: string): string => sourceNames[s] ?? s.replace(/_/g, " ");
  const header = <PageHeader title={t("rv6.title")} sub={t("rv6.sub")} right={help} />;
  if (noResults(counts, sources)) {
    return (
      <main className={pageMain} lang={lang} data-part="reports-v6">
        {header}
        <div className="mt-8">
          <EmptyNext title={t("rv6.empty.title")} text={t("rv6.empty.text")} action={{ href: startHref, label: t("rv6.empty.action") }} />
        </div>
        {more ? <div className="mt-8">{more}</div> : null}
      </main>
    );
  }
  const funnel = buildFunnel(counts);
  const widths = barWidths(funnel.map((s) => s.value));
  const sourceWidths = barWidths(sources.map((s) => s.visits));
  const costs = costResults(sources);
  const costWidths = barWidths(costs.map((c) => c.paise));
  const ranges = RANGES.map((r) => ({ id: r, label: t(`rv6.range.${r}`), href: rangeHref(r) }));
  const tile = (id: string, label: string, value: string, sub: string | null) => (
    <li key={id} data-tile={id} className={card}>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
    </li>
  );
  return (
    <main className={pageMain} lang={lang} data-part="reports-v6">
      {header}
      {mock ? (
        <p role="note" className="mt-3 text-sm text-muted">
          {t("rv6.mock")}
        </p>
      ) : null}
      <div className="mt-5">
        <ChipBar label={t("rv6.range.label")} chips={ranges} active={range} />
      </div>
      <ul data-part="tiles" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tile("visits", t("rv6.tile.visits"), counts.visits === null ? "-" : String(counts.visits), null)}
        {tile("quotes", t("rv6.tile.quotes"), quotesPaise === null ? "-" : formatRupeesShort(quotesPaise), counts.quotes === null ? null : t("rv6.tile.quotes.sub", { n: counts.quotes }))}
        {tile("won", t("rv6.tile.won"), counts.won === null ? "-" : String(counts.won), null)}
      </ul>

      <section aria-labelledby="rv6-funnel" data-part="funnel" className={`${card} mt-5`}>
        <h2 id="rv6-funnel" className={sectionTitle}>
          {t("rv6.funnel.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("rv6.funnel.sub")}</p>
        <ol className="mt-4 flex flex-col gap-4">
          {funnel.map((s, i) =>
            s.value === null ? (
              <li key={s.id} data-stage={s.id} className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] items-center gap-x-3 text-muted">
                <span className="text-base font-semibold">{t(`rv6.stage.${s.id}`)}</span>
                <span className="text-sm">{t("rv6.stage.unknown")}</span>
              </li>
            ) : (
              <HBar key={s.id} label={t(`rv6.stage.${s.id}`)} width={widths[i]} value={s.value} sub={s.previous === null ? null : t("rv6.stage.of", { n: s.value, m: s.previous })} />
            ),
          )}
        </ol>
      </section>

      <section aria-labelledby="rv6-sources" data-part="sources" className={`${card} mt-5`}>
        <h2 id="rv6-sources" className={sectionTitle}>
          {t("rv6.sources.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("rv6.sources.sub")}</p>
        {sources.length === 0 ? (
          <p className="mt-4 text-base text-muted">{t("rv6.sources.none")}</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-4">
            {sources.map((s, i) => (
              <HBar key={s.source} label={name(s.source)} width={sourceWidths[i]} value={t("rv6.sources.visits", { n: s.visits })} sub={t("rv6.sources.from", { n: s.enquiries })} />
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="rv6-cost" data-part="cost" className={`${card} mt-5`}>
        <h2 id="rv6-cost" className={sectionTitle}>
          {t("rv6.cost.title")}
        </h2>
        {costPerVisitPaise === null ? (
          <p className="mt-2 text-base text-muted">{t("rv6.cost.none")}</p>
        ) : (
          <>
            <p className="mt-2 font-display text-3xl font-semibold tabular-nums">{formatRupeesShort(costPerVisitPaise)}</p>
            <p className="text-sm text-muted">{t("rv6.cost.sub")}</p>
            {costs.length > 1 ? (
              <ol className="mt-4 flex flex-col gap-4">
                {costs.map((c, i) => (
                  <HBar key={c.source} label={name(c.source)} width={costWidths[i]} value={formatRupeesShort(c.paise)} />
                ))}
              </ol>
            ) : null}
          </>
        )}
      </section>
      <p className="mt-4 text-sm text-muted">
        <Link href={`${base}/outreach`} className="font-semibold text-brand-text underline">
          {t("rv6.link.campaigns")}
        </Link>
      </p>
      {more ? <div className="mt-8">{more}</div> : null}
    </main>
  );
}
