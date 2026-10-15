import type { MaterialQuoteDetailOut } from "@contracts";

import { formatRupees, rupeesInWords } from "@/lib/money";

import { PrintButton } from "../print/PrintButton";
import { say, type TodayWords } from "../today/today-words";
import { QuoteFigures } from "./QuoteFigures";
import { figuresFromQuote } from "./figures";

/**
 * A quotation as a page to print or save as PDF (job CO): the business, the number and date, who it is for and where it goes, the lines and totals, the amount in words, the payment terms and how long it is good for.
 * It says "Draft" across a quote that is not approved yet. It is not a GST invoice (invoices stay in the owner's accounting program) and says so. A plain page: the frame is left out when printing.
 */
export function QuotePrint({ business, quote, customer, site, words }: { business: string; quote: MaterialQuoteDetailOut; customer: string | null; site: string | null; words: TodayWords }) {
  return (
    <article data-print-doc data-screen="quote-print" className="mx-auto flex w-full max-w-3xl flex-col gap-4 bg-surface p-4 md:p-8 print:max-w-none print:bg-white print:p-0 print:text-black">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton label={say(words, "mat.pdf.print")} />
        <p className="text-sm text-muted">{say(words, "mat.pdf.hint")}</p>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="font-display text-2xl font-bold [overflow-wrap:anywhere]">{business}</p>
          <p className="text-lg font-semibold">{say(words, "mat.pdf.title")}</p>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-base">
          <dt className="font-semibold">{say(words, "mat.pdf.no")}</dt><dd>{quote.quote_no}</dd>
          <dt className="font-semibold">{say(words, "mat.q.made.on")}</dt><dd>{quote.as_of}</dd>
          <dt className="font-semibold">{say(words, "mat.q.valid")}</dt><dd>{quote.valid_until}</dd>
        </dl>
      </header>
      {quote.status !== "approved" ? <p className="rounded border border-amber-text px-3 py-1 text-center text-lg font-bold uppercase tracking-wide">{say(words, "mat.pdf.draft")}</p> : null}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-base">
        {customer ? (<><dt className="font-semibold">{say(words, "mat.pdf.to")}</dt><dd className="[overflow-wrap:anywhere]">{customer}</dd></>) : null}
        {site ? (<><dt className="font-semibold">{say(words, "mat.pdf.site")}</dt><dd className="[overflow-wrap:anywhere]">{site}</dd></>) : null}
      </dl>
      <QuoteFigures figures={figuresFromQuote(quote)} words={words} />
      <p className="text-base"><span className="font-semibold">{say(words, "mat.s.inwords")}: </span>{rupeesInWords(quote.total_paise)} ({formatRupees(quote.total_paise)})</p>
      <p className="text-sm">{say(words, "mat.pdf.terms", { advance: formatRupees(quote.advance_paise), balance: formatRupees(quote.balance_paise) })}</p>
      <p className="text-sm text-muted">{say(words, "mat.pdf.note")}</p>
    </article>
  );
}
