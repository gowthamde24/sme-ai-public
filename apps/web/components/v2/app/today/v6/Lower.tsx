import type { Say } from "../../words";
import type { ResultsStage, SourceCost } from "./results-data";

/** One visit of "Today's visits": the time in India ("11:00"), the name, a line under it. */
export type VisitRow = { id: string; time: string; who: string; line: string | null };

const card = "rounded-[18px] border border-line bg-surface shadow-[var(--v2-shadow)]";
const h2 = "mb-2.5 font-display text-[17px] font-extrabold";

/** "Today's visits" (the final design): the time in the display font on the left, the name in bold, a line under it. Drawn only when the visits could be read. */
export function VisitsCard({ rows, t }: { rows: readonly VisitRow[]; t: Say }) {
  return (
    <section data-part="todays-visits" aria-labelledby="todays-visits-h" className="min-w-0">
      <h2 id="todays-visits-h" className={h2}>
        {t("tv6.vis.title")}
      </h2>
      {rows.length === 0 ? (
        <p className={`${card} px-4 py-3.5 text-sm text-muted`}>{t("tv6.vis.none")}</p>
      ) : (
        <ul className={`${card} px-4 py-1.5`}>
          {rows.map((r) => (
            <li key={r.id} className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
              <span className="w-12 shrink-0 font-display text-[15px] font-extrabold">{r.time}</span>
              <div className="min-w-0">
                <p className="truncate font-bold">{r.who}</p>
                {r.line ? <p className="truncate text-[12.5px] text-muted">{r.line}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "This week's results" (the final design): the funnel (enquiries, called, visits booked, quotes sent, sales) as bars with the numbers on the right, and under it what a visit cost by source. A step that could not be read is left out; with nothing to show the card says so.
 * Each number appears once on the page.
 */
export function ResultsCard({ stages, costs, t }: { stages: readonly ResultsStage[]; costs: readonly SourceCost[]; t: Say }) {
  return (
    <section data-part="results" aria-labelledby="results-h" className="min-w-0">
      <h2 id="results-h" className={h2}>
        {t("tv6.res.title")}
      </h2>
      <div className={`${card} p-4`}>
        {stages.length === 0 ? (
          <p className="text-sm text-muted">{t("tv6.res.none")}</p>
        ) : (
          <ul data-part="funnel" className="flex flex-col gap-[7px]">
            {stages.map((s) => (
              <li key={s.id} className="grid grid-cols-[92px_minmax(0,1fr)_40px] items-center gap-2 text-[12.5px]">
                <span className="truncate text-muted">{t(`tv6.res.${s.id}`)}</span>
                <span className="block h-5 overflow-hidden rounded-md bg-surface-2">
                  <span style={{ display: "block", height: "100%", width: `${s.width}%` }}>
                    <i data-bar={s.id} className={`block h-full rounded-md ${s.id === "won" ? "bg-gradient-to-r from-green-text/60 to-green-text" : "bg-gradient-to-r from-brand/50 to-brand"}`} />
                  </span>
                </span>
                <b className="text-right tabular-nums">{s.value}</b>
              </li>
            ))}
          </ul>
        )}
        {costs.length > 0 ? (
          <ul data-part="cost-per-visit" className="mt-3.5 flex flex-col gap-2 border-t border-line pt-3">
            {costs.map((c) => (
              <li key={c.name} className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-2 text-[12.5px]">
                <span className="truncate text-muted">{c.name}</span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <span style={{ display: "block", height: "100%", width: `${c.width}%` }}>
                    <i className="block h-full rounded-full bg-brand" />
                  </span>
                </span>
                <b className="whitespace-nowrap text-xs">{t("tv6.res.per_visit", { amount: c.amountText })}</b>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
