import Link from "next/link";

import type { MaterialQuoteOut } from "@contracts";

import { formatRupees } from "@/lib/money";

import { PlushStill } from "../owl/PlushStill";
import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import { card, primary, secondary } from "../visits/styles";

const TONE = { draft: "neutral", approved: "green", rejected: "red", superseded: "amber" } as const;

/** The building-materials quotes, newest first (job CO): the number, who it is for, the total, the state and how long it is good for. Each row opens the quote. A quote is started from an enquiry whose requirement a person has approved. */
export function QuotesListView({ base, words, quotes, customers }: { base: string; words: TodayWords; quotes: readonly MaterialQuoteOut[] | null; customers: Readonly<Record<string, string>> }) {
  return (
    <div data-screen="material-quotes" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.quotes")}</h1>
          <p className="text-base text-muted">{say(words, "mat.ql.sub")}</p>
        </div>
        <Link href={`${base}/review`} className={primary}>{say(words, "mat.ql.start")}</Link>
      </header>
      {quotes === null ? (
        <div role="alert" className={`${card} flex-row items-center`} data-state="error">
          <PlushStill px={56} mood="resting" className="size-14" />
          <div>
            <p className="font-semibold">{say(words, "frame.notyet")}</p>
            <p className="text-sm text-muted">{say(words, "mat.ql.error")}</p>
          </div>
        </div>
      ) : quotes.length === 0 ? (
        <div className={`${card} items-start`} data-state="empty">
          <div className="flex items-center gap-3">
            <PlushStill px={64} mood="idle" className="size-16" />
            <h2 className="font-display text-2xl font-bold leading-tight">{say(words, "mat.ql.empty.title")}</h2>
          </div>
          <p className="text-base text-muted">{say(words, "mat.ql.empty.body")}</p>
          <Link href={`${base}/review`} className={secondary}>{say(words, "mat.ql.start")}</Link>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-list="quotes">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link href={`${base}/quotes/${q.id}`} data-quote={q.id} className={`${card} min-h-11 hover:border-brand-edge`}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-lg font-semibold">{say(words, "mat.q.title", { n: q.quote_no })}</span>
                  <Pill tone={TONE[q.status]}>{say(words, `mat.status.${q.status}`)}</Pill>
                </span>
                <span className="text-base [overflow-wrap:anywhere]">{customers[q.lead_id] ?? say(words, "site.customer.unknown")}</span>
                <span className="font-display text-xl font-bold tabular-nums">{formatRupees(q.total_paise)}</span>
                <span className="text-sm text-muted">{say(words, "mat.ql.valid", { date: q.valid_until })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
