import Link from "next/link";

import type { EntryOut, StatementOut } from "@contracts";

import { formatRupees } from "@/lib/money";

import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import { card } from "../visits/styles";
import { AgeingBar } from "./AgeingBar";
import { EntryVoid, type VoidAction } from "./EntryVoid";

/**
 * One party's account (jobs CO, CS): what was charged, what was paid, what is owed and how old it is, the claims still open with their due dates, and the entries newest first (a mistake is voided, never edited). The
 * numbers are the ledger's own (ADR 0086). `labels` swaps the words for the business type ("Invoiced" / "Fees charged"); a credit shows as a credit, never a negative balance.
 */
export function StatementView({ statement, entries, words, base, receiptBase, canVoid, voidEntry, prefix }: { statement: StatementOut; entries: readonly EntryOut[]; words: TodayWords; base: string; receiptBase: string; canVoid: boolean; voidEntry: VoidAction; prefix: "due" | "fee" }) {
  const s = statement;
  const k = (key: string) => say(words, `${prefix}.${key}`);
  return (
    <div data-part="statement" className="flex flex-col gap-5">
      <section className={card} aria-labelledby="st-owed">
        <h2 id="st-owed" className="sr-only">{k("owed")}</h2>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-muted">{k("owed")}</p>
            <p className="font-display text-3xl font-bold tabular-nums" data-owed>{formatRupees(s.outstanding_paise)}</p>
          </div>
          {s.overdue_paise > 0 ? <Pill tone="red">{say(words, "due.overdue", { amount: formatRupees(s.overdue_paise) })}</Pill> : <Pill tone="green">{say(words, "due.nothing.overdue")}</Pill>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-base md:grid-cols-4">
          <div><dt className="text-sm text-muted">{k("charged")}</dt><dd className="font-semibold tabular-nums">{formatRupees(s.invoiced_paise)}</dd></div>
          <div><dt className="text-sm text-muted">{k("paid")}</dt><dd className="font-semibold tabular-nums">{formatRupees(s.paid_paise)}</dd></div>
          {s.credit_paise > 0 ? <div><dt className="text-sm text-muted">{say(words, "due.credit")}</dt><dd className="font-semibold tabular-nums">{formatRupees(s.credit_paise)}</dd></div> : null}
          {s.credit_limit_paise !== null ? <div><dt className="text-sm text-muted">{say(words, "due.limit")}</dt><dd className="font-semibold tabular-nums">{formatRupees(s.credit_limit_paise)}</dd></div> : null}
        </dl>
        {s.over_limit ? <p role="note" className="rounded-lg border border-amber-text bg-amber-bg p-3 text-sm font-medium text-amber-text">{say(words, "due.over.limit", { limit: formatRupees(s.credit_limit_paise ?? 0) })}</p> : null}
        <AgeingBar ageing={s.ageing} words={words} />
      </section>
      {s.open_invoices.length > 0 ? (
        <section aria-labelledby="st-open" className="flex flex-col gap-2">
          <h2 id="st-open" className="font-display text-xl font-bold">{k("open")}</h2>
          <ul className="flex flex-col gap-2">
            {s.open_invoices.map((o) => (
              <li key={o.invoice_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2" data-open={o.invoice_id}>
                <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{o.invoice_no ?? o.reference ?? say(words, "due.entry.noref")}</span>
                <span className="text-sm text-muted">{say(words, "due.due.on", { date: o.due_date })}</span>
                <span className="font-semibold tabular-nums">{formatRupees(o.open_paise)}</span>
                {o.overdue_days > 0 ? <Pill tone="red">{say(words, "due.days.late", { n: o.overdue_days })}</Pill> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="st-entries" className="flex flex-col gap-2">
        <h2 id="st-entries" className="font-display text-xl font-bold">{say(words, "due.entries")}</h2>
        {entries.length === 0 ? (
          <p className="text-base text-muted">{say(words, "due.entries.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li key={e.id} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border bg-surface px-3 py-2 ${e.voided ? "border-dashed border-edge opacity-70" : "border-line"}`} data-entry={e.id} data-kind={e.kind} data-voided={e.voided ? "true" : undefined}>
                <span className="min-w-0">
                  <span className="font-semibold">{say(words, `due.kind.${e.kind}`)}</span>
                  <span className="block text-sm text-muted [overflow-wrap:anywhere]">
                    {[e.entry_date, e.invoice_no ?? e.reference, e.method ? say(words, `due.method.${e.method}`) : null, e.reason_code ? say(words, `due.reason.${e.reason_code}`) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`font-semibold tabular-nums ${e.direction === "credit" ? "text-green-text" : ""}`}>{e.direction === "credit" ? "−" : ""}{formatRupees(e.amount_paise)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {e.voided ? <Pill tone="neutral">{say(words, "due.voided")}</Pill> : null}
                  {e.kind === "payment" && e.receipt_no && !e.voided ? <Link href={`${receiptBase}/${e.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline">{say(words, "due.receipt", { no: e.receipt_no })}</Link> : null}
                  {canVoid && !e.voided ? <EntryVoid entryId={e.id} base={base} words={words} voidEntry={voidEntry} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
