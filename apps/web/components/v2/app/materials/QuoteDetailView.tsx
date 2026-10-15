import Link from "next/link";

import type { MaterialQuoteDetailOut } from "@contracts";

import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { okLine } from "../visits/styles";
import { QuoteActions, type QuoteStepActions } from "./QuoteActions";
import { QuoteFigures } from "./QuoteFigures";
import { figuresFromQuote } from "./figures";
import { traceSentence } from "./trace-text";

const TONE = { draft: "neutral", approved: "green", rejected: "red", superseded: "amber" } as const;

export type QuoteDetailViewProps = {
  base: string;
  words: TodayWords;
  role: Role;
  quote: MaterialQuoteDetailOut;
  customer: string | null;
  site: string | null;
  actions: QuoteStepActions | null;
  secondFactorMissing: boolean;
  made: boolean;
};

/** One material quote (job CO): who it is for and where it goes, the figures, why each number is what it is (the engine's own trace), and what can be done next. A viewer reads no money, so this page is not shown to one. */
export function QuoteDetailView({ base, words, role, quote, customer, site, actions, secondFactorMissing, made }: QuoteDetailViewProps) {
  const figures = figuresFromQuote(quote);
  return (
    <div data-screen="material-quote" className="flex flex-col gap-5">
      <p>
        <Link href={`${base}/quotes`} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">← {say(words, "nav.item.quotes")}</Link>
      </p>
      {made ? <p role="status" className={okLine}>{say(words, "mat.q.made")}</p> : null}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{say(words, "mat.q.title", { n: quote.quote_no })}</h1>
          <Pill tone={TONE[quote.status]}>{say(words, `mat.status.${quote.status}`)}</Pill>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-base [&>dt]:text-sm [&>dt]:font-semibold [&>dt]:text-muted">
          {customer ? (<><dt>{say(words, "mat.s.customer")}</dt><dd className="[overflow-wrap:anywhere]">{customer}</dd></>) : null}
          {site ? (<><dt>{say(words, "mat.q.site")}</dt><dd className="[overflow-wrap:anywhere]">{site}</dd></>) : null}
          <dt>{say(words, "mat.q.made.on")}</dt><dd>{quote.as_of}</dd>
          <dt>{say(words, "mat.q.valid")}</dt><dd>{quote.valid_until}</dd>
          <dt>{say(words, "mat.q.enquiry")}</dt><dd><Link href={`${base}/enquiries/${quote.enquiry_id}`} className="font-semibold text-brand-text underline">{say(words, "mat.q.enquiry.open")}</Link></dd>
        </dl>
        {quote.reject_code ? <p className="text-base">{say(words, "mat.q.rejected.because", { why: say(words, `mat.reject.${quote.reject_code}`) })}</p> : null}
      </header>
      <QuoteFigures figures={figures} words={words} />
      {quote.trace.length > 0 ? (
        <details className="rounded-xl border border-line bg-surface p-3" data-part="trace">
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-brand-text">{say(words, "mat.q.trace")}</summary>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm [overflow-wrap:anywhere]">
            {quote.trace.map((t, i) => (<li key={`${t.rule_id}-${i}`}>{traceSentence(t, words)}</li>))}
          </ol>
          <p className="mt-2 text-xs text-muted">{say(words, "mat.q.engine", { v: quote.engine_version })}</p>
        </details>
      ) : null}
      {actions ? (
        <QuoteActions
          quote={{ id: quote.id, quoteNo: quote.quote_no, status: quote.status, totalPaise: quote.total_paise, advancePaise: quote.advance_paise, trips: quote.trips, needsOwner: quote.needs_owner_approval, customer, validUntil: quote.valid_until }}
          role={role}
          base={base}
          words={words}
          actions={actions}
          secondFactorMissing={secondFactorMissing}
        />
      ) : null}
    </div>
  );
}
