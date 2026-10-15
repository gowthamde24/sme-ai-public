import type { Cell, Report, ReportKpi, ReportTable } from "@/lib/api/reports";
import { formatRupees, groupIndian } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";
import { card } from "../visits/styles";

/**
 * Drawing a report (jobs CS, CU): the figures, a table or a bar per day, from the ONE shape every pack's reports use. A figure or a column is drawn by its TYPE (a count, rupees, a percent), never by guessing from its name, and
 * its words come from the string store by its key (`rep.kpi.*`, `rep.col.*`, `rep.table.*`, `rep.series.*`, `rep.val.*`); a key with no words is drawn as its plain name, never as a raw code with underscores. A figure that cannot be
 * worked out (a percent of nothing) is a dash. Nothing here adds, rounds or compares: the report's own numbers are shown.
 */
export function formatValue(value: number | null, unit: ReportKpi["unit"] | ReportTable["columns"][number]["type"]): string {
  if (value === null) return "—";
  if (unit === "paise") return formatRupees(value);
  if (unit === "percent") return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
  if (unit === "seconds") return `${Math.round(value)}`;
  return groupIndian(Math.round(value));
}

/** The bar widths are classes the stylesheet knows (no inline style): the nearest of ten steps, never less than one. */
const WIDTH = ["w-0", "w-[10%]", "w-[20%]", "w-[30%]", "w-[40%]", "w-[50%]", "w-[60%]", "w-[70%]", "w-[80%]", "w-[90%]", "w-full"];
const plain = (key: string) => key.replace(/_/g, " ").replace(/\b\w/, (c) => c.toUpperCase());
export const wordFor = (words: TodayWords, key: string): string => words[key] ?? plain(key.split(".").pop() ?? key);

export function KpiCards({ kpis, words, only }: { kpis: readonly ReportKpi[]; words: TodayWords; only?: readonly string[] }) {
  const shown = only ? kpis.filter((k) => only.includes(k.key)) : kpis;
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3" data-part="kpis">
      {shown.map((k) => (
        <div key={k.key} className="rounded-xl border border-line bg-surface p-3" data-kpi={k.key}>
          <dt className="text-sm text-muted">{wordFor(words, `rep.kpi.${k.key}`)}</dt>
          <dd className="font-display text-2xl font-bold tabular-nums">{formatValue(k.value, k.unit)}</dd>
        </div>
      ))}
    </dl>
  );
}

function cellText(cell: Cell, type: ReportTable["columns"][number]["type"], key: string, words: TodayWords): string {
  if (cell === null) return "—";
  if (type === "text") return typeof cell === "string" ? (words[`rep.val.${key}.${cell}`] ?? cell) : String(cell);
  return typeof cell === "number" ? formatValue(cell, type) : "—";
}

export function ReportTableView({ table, words, id }: { table: ReportTable; words: TodayWords; id: string }) {
  return (
    <section aria-labelledby={id} className={card} data-table={table.key}>
      <h2 id={id} className="font-display text-xl font-bold">{wordFor(words, `rep.table.${table.key}`)}</h2>
      {table.rows.length === 0 ? (
        <p className="text-base text-muted">{say(words, "rep.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left text-base">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c.key} scope="col" className={`border-b border-line px-2 py-2 text-sm font-semibold text-muted ${c.type === "text" ? "" : "text-right"}`}>{wordFor(words, `rep.col.${c.key}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {row.map((cell, j) => {
                    const col = table.columns[j];
                    return <td key={col.key} className={`px-2 py-2 ${col.type === "text" ? "[overflow-wrap:anywhere]" : "text-right tabular-nums"}`}>{cellText(cell, col.type, col.key, words)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One bar per day, as wide as its share of the largest day. The numbers are the report's own; the bars only show them. */
export function SeriesBars({ series, words, unit, id }: { series: Report["series"][number]; words: TodayWords; unit: "paise" | "count"; id: string }) {
  const max = Math.max(1, ...series.points.map((p) => p.value));
  return (
    <section aria-labelledby={id} className={card} data-series={series.key}>
      <h2 id={id} className="font-display text-xl font-bold">{wordFor(words, `rep.series.${series.key}`)}</h2>
      {series.points.length === 0 ? (
        <p className="text-base text-muted">{say(words, "rep.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {series.points.map((p) => (
            <li key={p.day} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
              <span className="tabular-nums text-muted">{p.day}</span>
              <span className="h-3 rounded-full bg-surface-2" aria-hidden="true"><span className={`block h-3 rounded-full bg-brand ${WIDTH[Math.max(1, Math.round((p.value / max) * 10))]}`} /></span>
              <span className="font-semibold tabular-nums">{formatValue(p.value, unit)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
