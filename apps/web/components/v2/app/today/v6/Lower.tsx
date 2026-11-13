import type { Say } from "../../words";

/** One row of "Where enquiries came from": a source (named), how many enquiries and how many visits it brought. */
export type SourceRow = { name: string; enquiries: number; visits: number };
/** One visit of "Today's visits": the time in India ("11:00"), the name, a line under it. */
export type VisitRow = { id: string; time: string; who: string; line: string | null };

const card = "overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--v2-shadow)]";

/** "Today's visits" (the approved mock): the time on the left, the name in bold, a line under it. Drawn only when the visits could be read. */
export function VisitsCard({ rows, t }: { rows: readonly VisitRow[]; t: Say }) {
  return (
    <section data-part="todays-visits" aria-labelledby="todays-visits-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="todays-visits-h" className="font-display text-xl font-semibold md:text-2xl">
        {t("tv6.vis.title")}
      </h2>
      {rows.length === 0 ? (
        <p className={`${card} px-[18px] py-3.5 text-sm text-muted`}>{t("tv6.vis.none")}</p>
      ) : (
        <ul className={card}>
          {rows.map((r) => (
            <li key={r.id} className="flex gap-3 border-t border-line px-[18px] py-3 first:border-t-0">
              <span className="w-[46px] shrink-0 text-[12.5px] text-muted">{r.time}</span>
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

/** "Where enquiries came from" (the approved mock): each source with its enquiries and the visits it brought, the numbers on the right. Drawn only when there is a source to show. */
export function SourcesCard({ rows, t }: { rows: readonly SourceRow[]; t: Say }) {
  if (rows.length === 0) return null;
  return (
    <section data-part="sources" aria-labelledby="sources-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="sources-h" className="font-display text-xl font-semibold md:text-2xl">
        {t("tv6.src.title")}
      </h2>
      <ul className={`${card} px-[18px] py-2.5 text-[13.5px]`}>
        {rows.map((r) => (
          <li key={r.name} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="min-w-0 truncate">{r.name}</span>
            <b className="shrink-0 whitespace-nowrap">{t(r.visits === 1 ? "tv6.src.row.one" : "tv6.src.row.other", { n: r.enquiries, v: r.visits })}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
