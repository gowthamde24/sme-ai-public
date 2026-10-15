import * as React from "react";

import type { ReceiptOut } from "@contracts";

import { formatRupees, rupeesInWords } from "@/lib/money";

import { CopyButton } from "../print/CopyButton";
import { PrintButton } from "../print/PrintButton";
import { say, type TodayWords } from "../today/today-words";

/**
 * A receipt for a payment, as a page to print or save as PDF (jobs CO, CS): the business, the receipt number (one series per business per financial year), the date, who paid, how much (also in words), the method, what it
 * was set against and the balance after. A voided receipt says so across the page. It is a receipt for money received, not a GST invoice.
 */
export function ReceiptPrint({ receipt, words, prefix, extra = [], copyText }: { receipt: ReceiptOut; words: TodayWords; prefix: "due" | "fee"; extra?: readonly { label: string; value: string }[]; copyText?: string }) {
  const r = receipt;
  return (
    <article data-print-doc data-screen="receipt" className="mx-auto flex w-full max-w-xl flex-col gap-4 bg-surface p-4 md:p-8 print:max-w-none print:bg-white print:p-0 print:text-black">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton label={say(words, "mat.pdf.print")} />
        {copyText ? <CopyButton label={say(words, "fee.receipt.copy")} copiedLabel={say(words, "fee.receipt.copied")} text={copyText} /> : null}
        <p className="text-sm text-muted">{say(words, "mat.pdf.hint")}</p>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="font-display text-2xl font-bold [overflow-wrap:anywhere]">{r.business_name}</p>
          <p className="text-lg font-semibold">{say(words, "due.receipt.title")}</p>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-base">
          <dt className="font-semibold">{say(words, "due.receipt.no")}</dt><dd data-receipt-no>{r.receipt_no}</dd>
          <dt className="font-semibold">{say(words, "due.s.received")}</dt><dd>{r.received_on}</dd>
        </dl>
      </header>
      {r.voided ? <p className="rounded border border-red-text px-3 py-1 text-center text-lg font-bold uppercase tracking-wide">{say(words, "due.receipt.voided")}</p> : null}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-base">
        {r.party_name ? (<><dt className="font-semibold">{say(words, "due.receipt.from")}</dt><dd className="[overflow-wrap:anywhere]">{r.party_name}</dd></>) : null}
        {extra.map((x) => (<React.Fragment key={x.label}><dt className="font-semibold">{x.label}</dt><dd className="[overflow-wrap:anywhere]">{x.value}</dd></React.Fragment>))}
        <dt className="font-semibold">{say(words, "due.receipt.amount")}</dt><dd className="font-display text-2xl font-bold tabular-nums">{formatRupees(r.amount_paise)}</dd>
        <dt className="font-semibold">{say(words, "mat.s.inwords")}</dt><dd>{rupeesInWords(r.amount_paise)}</dd>
        <dt className="font-semibold">{say(words, "due.s.method")}</dt><dd>{say(words, `due.method.${r.method}`)}</dd>
        {r.against ? (<><dt className="font-semibold">{say(words, "due.receipt.against")}</dt><dd className="[overflow-wrap:anywhere]">{r.against}</dd></>) : null}
        <dt className="font-semibold">{say(words, `${prefix}.receipt.balance`)}</dt><dd className="tabular-nums">{formatRupees(Math.max(0, r.balance_after_paise))}</dd>
      </dl>
      <div className="grid grid-cols-2 gap-8 pt-10 text-sm"><p className="border-t border-ink pt-1">{say(words, "due.receipt.sign")}</p><span /></div>
      <p className="text-sm text-muted">{say(words, "due.receipt.note")}</p>
    </article>
  );
}
