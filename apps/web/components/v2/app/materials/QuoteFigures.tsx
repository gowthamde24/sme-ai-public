import { formatRupees, groupIndian, areaText, percentFromBps } from "@/lib/money";

import { say, type TodayWords } from "../today/today-words";
import { unitWord } from "./mat-logic";
import { FLAG_CODES, type Figures } from "./figures";

const row = "flex items-baseline justify-between gap-3 py-1.5";

/**
 * What is billed on a line, as a person reads it (job DF). For a product sold by area the engine bills in hundredths of a unit (105000 is 1,050 sq ft: `billed_quantity` is `delivered_area_x100` or the plain area x100), exactly like the
 * customer text the API writes (`app/materials/text.py`); a product sold by the piece, the bag or the tonne bills whole units. Showing the raw 105000 next to a rate of ₹65.00 made a line look like ₹68 lakh.
 */
export function billedText(l: Pick<Figures["lines"][number], "soldPer" | "billedQuantity" | "deliveredAreaX100">): string {
  return (l.soldPer === "sq_ft" || l.soldPer === "sq_m") && l.deliveredAreaX100 !== null ? areaText(l.billedQuantity) : groupIndian(l.billedQuantity);
}

/**
 * The figures of a material quote as a person reads them (job CO): each line with its measure, pieces, pallets and amount; then material, transport, loading, laying, GST and the total; then the advance and the balance
 * and how long the quote is good for. The same component draws a preview and a stored quote. Amounts are the engine's, written with the Indian grouping; nothing is calculated here.
 */
export function QuoteFigures({ figures, words }: { figures: Figures; words: TodayWords }) {
  const f = figures;
  return (
    <div data-part="figures" className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[34rem] border-collapse text-left text-base">
          <caption className="sr-only">{say(words, "mat.q.lines")}</caption>
          <thead>
            <tr className="bg-surface-2 text-sm font-semibold">
              <th scope="col" className="px-3 py-2">{say(words, "mat.q.col.item")}</th>
              <th scope="col" className="px-3 py-2 text-right">{say(words, "mat.q.col.qty")}</th>
              <th scope="col" className="px-3 py-2 text-right">{say(words, "mat.q.col.rate")}</th>
              <th scope="col" className="px-3 py-2 text-right">{say(words, "mat.q.col.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {f.lines.map((l, i) => (
              <tr key={`${l.name}-${i}`} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-2 font-semibold [overflow-wrap:anywhere]">
                  {l.name}
                  <span className="mt-0.5 block text-sm font-normal text-muted">
                    {l.areaX100 !== null && l.areaUnit ? `${say(words, "mat.q.area", { n: areaText(l.areaX100), unit: unitWord(words, l.areaUnit) })}` : ""}
                    {l.pieces !== null ? `${l.areaX100 !== null ? " · " : ""}${say(words, "mat.q.pieces", { n: groupIndian(l.pieces) })}` : ""}
                    {l.pallets !== null ? ` · ${say(words, "mat.q.pallets", { n: groupIndian(l.pallets) })}` : ""}
                  </span>
                  <span className="block text-sm font-normal text-muted">{say(words, "mat.q.gst", { n: percentFromBps(l.gstBps) })}</span>
                </th>
                <td className="px-3 py-2 text-right tabular-nums">{billedText(l)} {unitWord(words, l.soldPer)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatRupees(l.unitPricePaise)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatRupees(l.materialPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="flex flex-col divide-y divide-line rounded-xl border border-line px-3" data-part="totals">
        <div className={row}><dt>{say(words, "mat.q.material")}</dt><dd className="tabular-nums">{formatRupees(f.materialPaise)}</dd></div>
        <div className={row}><dt>{say(words, "mat.q.transport", { n: f.trips ?? 0 })}</dt><dd className="tabular-nums">{formatRupees(f.transportPaise)}</dd></div>
        {f.handlingPaise > 0 ? <div className={row}><dt>{say(words, "mat.q.handling")}</dt><dd className="tabular-nums">{formatRupees(f.handlingPaise)}</dd></div> : null}
        {f.layingPaise > 0 ? <div className={row}><dt>{say(words, "mat.q.laying")}</dt><dd className="tabular-nums">{formatRupees(f.layingPaise)}</dd></div> : null}
        <div className={row}><dt>{say(words, "mat.q.tax")}</dt><dd className="tabular-nums">{formatRupees(f.taxPaise)}</dd></div>
        <div className={`${row} font-display text-xl font-bold`}><dt>{say(words, "mat.q.total")}</dt><dd className="tabular-nums" data-total>{formatRupees(f.totalPaise)}</dd></div>
        <div className={row}><dt>{say(words, "mat.q.advance")}</dt><dd className="tabular-nums">{formatRupees(f.advancePaise)}</dd></div>
        <div className={row}><dt>{f.balanceOn === "credit_days" && f.dueDate ? say(words, "mat.q.balance.credit", { date: f.dueDate }) : say(words, "mat.q.balance.delivery")}</dt><dd className="tabular-nums">{formatRupees(f.balancePaise)}</dd></div>
        {f.validUntil ? <div className={row}><dt>{say(words, "mat.q.valid")}</dt><dd>{f.validUntil}</dd></div> : null}
      </dl>
      {f.rangeLowPaise !== null && f.rangeHighPaise !== null && f.rangeLowPaise !== f.rangeHighPaise ? (
        <p className="text-sm text-muted">{say(words, "mat.q.range", { low: formatRupees(f.rangeLowPaise), high: formatRupees(f.rangeHighPaise) })}</p>
      ) : null}
      {f.flags.length > 0 ? (
        <ul role="note" className="flex flex-col gap-1 rounded-lg border border-amber-text bg-amber-bg p-3 text-sm font-medium text-amber-text" data-part="flags">
          {f.flags.map((c) => (
            <li key={c}>{say(words, (FLAG_CODES as readonly string[]).includes(c) ? `mat.flag.${c}` : "mat.flag.OTHER")}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
