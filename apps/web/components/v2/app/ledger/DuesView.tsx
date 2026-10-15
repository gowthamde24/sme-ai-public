import Link from "next/link";

import type { SummaryRowOut } from "@contracts";

import { formatRupees } from "@/lib/money";

import { PlushStill } from "../owl/PlushStill";
import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import { card, secondary } from "../visits/styles";
import { AgeingBar } from "./AgeingBar";
import { totals } from "./ledger-logic";

/**
 * What customers owe (job CO): the total, how much of it is overdue, how old it is, and the customers with the largest balance first; a customer over the credit limit is marked. The numbers are the ledger's own;
 * nothing is worked out here but their sum. A customer opens to the account, where a payment is written down. Owner, Admin and Sales; a Viewer reads no money.
 */
export function DuesView({ base, words, rows, more, help }: { base: string; words: TodayWords; rows: readonly SummaryRowOut[] | null; more: string | null; help?: React.ReactNode }) {
  const t = rows ? totals(rows) : null;
  return (
    <div data-screen="dues" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.dues")}</h1>
        <p className="text-base text-muted">{say(words, "due.sub")}</p>
      </header>
      {help}
      {rows === null ? (
        <div role="alert" className={`${card} flex-row items-center`} data-state="error">
          <PlushStill px={56} mood="resting" className="size-14" />
          <div>
            <p className="font-semibold">{say(words, "frame.notyet")}</p>
            <p className="text-sm text-muted">{say(words, "due.error")}</p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className={`${card} items-start`} data-state="empty">
          <div className="flex items-center gap-3">
            <PlushStill px={64} mood="idle" className="size-16" />
            <h2 className="font-display text-2xl font-bold leading-tight">{say(words, "due.empty.title")}</h2>
          </div>
          <p className="text-base text-muted">{say(words, "due.empty.body")}</p>
          <Link href={`${base}/orders`} className={secondary}>{say(words, "due.empty.go")}</Link>
        </div>
      ) : t ? (
        <>
          <section className={card} aria-labelledby="dues-total" data-part="dues-total">
            <h2 id="dues-total" className="sr-only">{say(words, "due.total")}</h2>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-muted">{say(words, "due.total")}</p>
                <p className="font-display text-3xl font-bold tabular-nums">{formatRupees(t.outstanding)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {t.overdue > 0 ? <Pill tone="red">{say(words, "due.overdue", { amount: formatRupees(t.overdue) })}</Pill> : <Pill tone="green">{say(words, "due.nothing.overdue")}</Pill>}
                {t.over > 0 ? <Pill tone="amber">{say(words, "due.over.count", { n: t.over })}</Pill> : null}
              </div>
            </div>
            <AgeingBar ageing={t.ageing} words={words} />
          </section>
          <ul className="grid gap-3 md:grid-cols-2" data-list="dues">
            {rows.map((r) => (
              <li key={r.account_id ?? r.company_id ?? r.contact_id}>
                <Link href={`${base}/dues/${r.company_id ?? ""}`} className={`${card} min-h-11 hover:border-brand-edge`} data-customer={r.company_id}>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{r.party_name ?? r.company_name ?? say(words, "site.customer.unknown")}</span>
                    {r.over_limit ? <Pill tone="amber">{say(words, "due.over.badge")}</Pill> : null}
                  </span>
                  <span className="font-display text-xl font-bold tabular-nums">{formatRupees(r.outstanding_paise)}</span>
                  <span className="text-sm text-muted">{r.overdue_paise > 0 ? say(words, "due.overdue", { amount: formatRupees(r.overdue_paise) }) : say(words, "due.nothing.overdue")}</span>
                </Link>
              </li>
            ))}
          </ul>
          {more ? <p><Link href={`${base}/dues?after=${encodeURIComponent(more)}`} className={secondary}>{say(words, "mat.products.more")}</Link></p> : null}
        </>
      ) : null}
    </div>
  );
}
