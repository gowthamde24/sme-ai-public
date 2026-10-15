import type { ChallanOut } from "@contracts";

import { PrintButton } from "../print/PrintButton";
import { say, type TodayWords } from "../today/today-words";
import { groupIndianSafe } from "./format";

/**
 * The delivery note (challan) of a trip as a page to print or save as PDF (job CO): the business, the note and trip numbers, the date, who it is for and where it goes, the vehicle and driver, what is on the truck, and
 * two empty lines to sign by the person who receives the goods. It has NO amounts and NO tax: a GST invoice comes from the owner's accounting program. A received trip shows the name and the time.
 */
export function ChallanPrint({ challan, words }: { challan: ChallanOut; words: TodayWords }) {
  const c = challan;
  return (
    <article data-print-doc data-screen="challan" className="mx-auto flex w-full max-w-3xl flex-col gap-4 bg-surface p-4 md:p-8 print:max-w-none print:bg-white print:p-0 print:text-black">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton label={say(words, "mat.pdf.print")} />
        <p className="text-sm text-muted">{say(words, "mat.pdf.hint")}</p>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="font-display text-2xl font-bold [overflow-wrap:anywhere]">{c.business}</p>
          <p className="text-lg font-semibold">{say(words, "trip.challan.title")}</p>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-base">
          <dt className="font-semibold">{say(words, "trip.challan.no")}</dt><dd>{c.challan_no}</dd>
          <dt className="font-semibold">{say(words, "trip.challan.order")}</dt><dd>{c.order_no} / {c.trip_no}</dd>
          <dt className="font-semibold">{say(words, "trip.field.date")}</dt><dd>{c.date}</dd>
        </dl>
      </header>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-base">
        {c.customer ? (<><dt className="font-semibold">{say(words, "mat.pdf.to")}</dt><dd className="[overflow-wrap:anywhere]">{c.customer}</dd></>) : null}
        {c.site ? (<><dt className="font-semibold">{say(words, "mat.pdf.site")}</dt><dd className="[overflow-wrap:anywhere]">{[c.site.name, c.site.address_line, c.site.city, c.site.pin].filter(Boolean).join(", ")}{c.site.access_notes ? <span className="block text-sm text-muted">{c.site.access_notes}</span> : null}</dd></>) : null}
        {c.site_contact ? (<><dt className="font-semibold">{say(words, "trip.challan.contact")}</dt><dd>{c.site_contact.name}{c.site_contact.phone ? `, ${c.site_contact.phone}` : ""}</dd></>) : null}
        {c.vehicle_no ? (<><dt className="font-semibold">{say(words, "trip.field.vehicle")}</dt><dd>{c.vehicle_no}</dd></>) : null}
        {c.driver_name ? (<><dt className="font-semibold">{say(words, "trip.field.driver")}</dt><dd>{c.driver_name}{c.driver_phone ? `, ${c.driver_phone}` : ""}</dd></>) : null}
      </dl>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left text-base">
          <caption className="sr-only">{say(words, "trip.challan.lines")}</caption>
          <thead>
            <tr className="bg-surface-2 text-sm font-semibold">
              <th scope="col" className="px-3 py-2">#</th>
              <th scope="col" className="px-3 py-2">{say(words, "mat.q.col.item")}</th>
              <th scope="col" className="px-3 py-2 text-right">{say(words, "mat.q.col.qty")}</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.line_no} className="border-t border-line">
                <td className="px-3 py-2">{l.line_no}</td>
                <td className="px-3 py-2 font-semibold [overflow-wrap:anywhere]">{l.description}{l.hsn ? <span className="block text-sm font-normal text-muted">HSN {l.hsn}</span> : null}</td>
                <td className="px-3 py-2 text-right tabular-nums">{groupIndianSafe(l.quantity)} {l.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.received_by ? (
        <p className="text-base">{say(words, "trip.challan.received", { name: c.received_by, at: c.received_at ?? "" })}</p>
      ) : (
        <div className="grid grid-cols-2 gap-8 pt-10 text-sm">
          <p className="border-t border-ink pt-1">{say(words, "trip.challan.sign.receiver")}</p>
          <p className="border-t border-ink pt-1">{say(words, "trip.challan.sign.driver")}</p>
        </div>
      )}
      <p className="text-sm text-muted">{say(words, "trip.challan.note")}</p>
    </article>
  );
}
