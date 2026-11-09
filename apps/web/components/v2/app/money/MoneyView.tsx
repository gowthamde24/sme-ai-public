import Link from "next/link";
import type { ReactNode } from "react";

import type { MoneySummary } from "@/lib/api/money";
import { formatRupeesShort } from "@/lib/money";

type W = Readonly<Record<string, string>>;
export type MoneyViewProps = { summary: MoneySummary | null; w: W; base: string; /** the Remind button for a row (a client island the page makes); null = none (a Viewer) */ remind: ((row: MoneySummary["top"][number]) => ReactNode) | null; /** "See every account": the Dues page, where the business type has it */ duesHref: string | null; when: (day: string) => string };

/**
 * Money (app v4 part 6, Sales > Money): what customers owe, how much of it is overdue and what was paid this month, then the customers who owe the most, each with its balance, what is overdue, a link to the account and Remind (always a
 * draft for the owner's OK, never sent). Every number is the API's (the ledger's own sums); nothing is worked out here. A summary that could not be read says so, never "nothing owed".
 */
export function MoneyView({ summary, w, base, remind, duesHref, when }: MoneyViewProps) {
  const n = (key: string, v: number) => (w[`${key}.${v === 1 ? "one" : "other"}`] ?? "").replace("{n}", v.toLocaleString("en-IN"));
  if (summary === null)
    return (
      <p role="alert" className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted" data-state="unread">
        {w["mo.unread"]}
      </p>
    );
  const stat = (key: string, amount: number, sub: string, tone: "plain" | "red") => (
    <div className="flex flex-col gap-1 rounded-[22px] border border-line bg-surface p-4" data-stat={key}>
      <p className="m-0 text-sm font-semibold text-muted">{w[`mo.${key}`]}</p>
      <p className={`m-0 font-display text-3xl font-bold tabular-nums ${tone === "red" && amount > 0 ? "text-red-text" : ""}`}>{formatRupeesShort(amount)}</p>
      <p className="m-0 text-sm text-muted">{sub}</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-5" data-screen="money">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
        {stat("owed", summary.owedPaise, n("mo.customers", summary.customersOwing), "plain")}
        {stat("overdue", summary.overduePaise, summary.customersOverdue > 0 ? n("mo.customers", summary.customersOverdue) : w["mo.none_overdue"], "red")}
        {stat("paid", summary.paidThisMonthPaise, (w["mo.since"] ?? "").replace("{date}", when(summary.monthFrom)), "plain")}
      </div>
      <section aria-labelledby="mo-top" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="mo-top" className="m-0 font-display text-xl font-bold">
            {w["mo.top"]}
          </h2>
          {duesHref ? (
            <Link href={duesHref} className="text-sm font-semibold text-brand-text underline underline-offset-4">
              {w["mo.all"]}
            </Link>
          ) : null}
        </div>
        {summary.top.length === 0 ? (
          <p className="m-0 rounded-2xl border border-line bg-surface p-4 text-sm text-muted" data-state="empty">
            {w["mo.empty"]}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-part="money-top">
            {summary.top.map((r) => (
              <li key={r.accountId ?? `${r.companyId}-${r.contactId}`} data-row={r.accountId ?? ""} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface p-3.5">
                <div className="flex min-w-0 flex-col">
                  {r.companyId && duesHref ? (
                    <Link href={`${base}/dues/${r.companyId}`} className="font-semibold text-ink underline-offset-4 hover:underline [overflow-wrap:anywhere]">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-semibold [overflow-wrap:anywhere]">{r.name}</span>
                  )}
                  <span className="text-sm text-muted">
                    {w["mo.owes"]} <strong className="tabular-nums text-ink">{formatRupeesShort(r.outstandingPaise)}</strong>
                    {r.overduePaise > 0 ? (
                      <>
                        {" · "}
                        <span className="font-semibold text-red-text">{(w["mo.overdue_amount"] ?? "").replace("{amount}", formatRupeesShort(r.overduePaise))}</span>
                      </>
                    ) : null}
                  </span>
                </div>
                {remind && r.overduePaise > 0 ? remind(r) : null}
              </li>
            ))}
          </ul>
        )}
        {!summary.complete ? <p className="m-0 text-sm text-muted">{w["mo.partial"]}</p> : null}
      </section>
      <p className="m-0 text-sm text-muted">{w["mo.note"]}</p>
    </div>
  );
}
