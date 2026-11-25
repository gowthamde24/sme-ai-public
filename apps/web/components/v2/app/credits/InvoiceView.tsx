import Link from "next/link";

import type { Invoice } from "@/lib/api/credits";

import { makeT, type Words } from "../words";

/** One GST invoice as a plain printable page (the server sends no PDF): number, date, buyer, what, the amounts with GST split, and a Draft note when the seller's tax details are not set yet (it is then not a valid tax invoice). */
export function InvoiceView({ invoice, words, back }: { invoice: Invoice; words: Words; back: string }) {
  const t = makeT(words);
  const when = new Date(invoice.issuedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
  return (
    <article data-part="invoice" className="flex max-w-2xl flex-col gap-4">
      <Link href={back} className="inline-block py-1.5 text-[15px] font-semibold text-muted hover:text-ink print:hidden">
        {t("cr.inv.back")}
      </Link>
      {invoice.draft ? (
        <p role="note" className="m-0 border-y border-line py-3 text-[15px] font-semibold text-ink">
          {t("cr.inv.draft")}
        </p>
      ) : null}
      <h1 className="m-0 font-display text-2xl font-semibold">{t("cr.invoice", { n: invoice.number })}</h1>
      <dl className="m-0 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">{when}</dt>
          <dd className="m-0 font-semibold text-ink">{invoice.sellerName ?? ""}</dd>
          {invoice.sellerGstin ? <dd className="m-0 text-[15px] text-muted">GSTIN {invoice.sellerGstin}</dd> : null}
        </div>
        <div>
          <dt className="text-sm text-muted">&nbsp;</dt>
          <dd className="m-0 font-semibold text-ink">{invoice.buyerName ?? ""}</dd>
          {invoice.buyerGstin ? <dd className="m-0 text-[15px] text-muted">GSTIN {invoice.buyerGstin}</dd> : null}
        </div>
      </dl>
      <div className="border-t border-ink">
        <div className="flex justify-between gap-4 border-b border-line py-3 text-[15px]">
          <span>{invoice.description}</span>
          <b className="text-ink">{invoice.subtotalText}</b>
        </div>
        {invoice.lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-4 border-b border-line py-3 text-[15px] text-muted">
            <span>{l.label}</span>
            <span>{l.text}</span>
          </div>
        ))}
        {invoice.lines.length === 0 ? (
          <div className="flex justify-between gap-4 border-b border-line py-3 text-[15px] text-muted">
            <span>GST{invoice.gstPercent ? ` ${invoice.gstPercent}%` : ""}</span>
            <span>{invoice.gstText}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-b border-line py-3 text-[16px]">
          <b className="text-ink">Total</b>
          <b className="text-ink">{invoice.totalText}</b>
        </div>
      </div>
      <button type="button" className="print:hidden hidden" aria-hidden="true">
        {t("cr.inv.print")}
      </button>
    </article>
  );
}
