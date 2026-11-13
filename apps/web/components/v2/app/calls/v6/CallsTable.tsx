import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/v2/app/ds/StatusPill";
import type { CallRow } from "@/lib/api/calls";
import { callsHref, type CallsQuery } from "@/lib/calls/filter";
import { callSentence, callStatus, sentenceText } from "@/lib/calls/status";
import { callClock, refuseWhy } from "@/lib/calls/view";
import { formatRupeesShort } from "@/lib/money";

import { makeT, type Words } from "../../words";

/**
 * The table of calls (design system v6): Customer (with In/Out) · What happened (the outcome sentence) · Status pill · Duration · Cost in ₹ · Time. The whole row opens the call in the panel beside it (the name is the link, its stretched area covers the row).
 * On a phone each row is a card: the name and time on top, the sentence under them, then the status, length and cost. The selected row is marked. Server markup, no script.
 */
export type CallsTableProps = { words: Words; base: string; query: CallsQuery; items: readonly CallRow[]; selectedId: string | null; when: (iso: string) => string };

export function CallsTable({ words, base, query, items, selectedId, when }: CallsTableProps) {
  const t = makeT(words);
  const why = (reason: string | null) => words[`ph.why.${refuseWhy(reason)}`] ?? "";
  const head = "px-3 py-2 text-left text-sm font-semibold text-muted";
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--v2-shadow)]" data-part="calls-table">
      <table className="block w-full border-collapse md:table">
        <caption className="sr-only">{t("calls6.table.caption")}</caption>
        <thead className="hidden border-b border-line bg-surface-2 md:table-header-group">
          <tr>
            <th scope="col" className={head}>{t("calls6.col.customer")}</th>
            <th scope="col" className={head}>{t("calls6.col.what")}</th>
            <th scope="col" className={head}>{t("calls6.col.status")}</th>
            <th scope="col" className={`${head} text-right`}>{t("calls6.col.duration")}</th>
            <th scope="col" className={`${head} text-right`}>{t("calls6.col.cost")}</th>
            <th scope="col" className={head}>{t("calls6.col.time")}</th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {items.map((c) => {
            const status = callStatus(c);
            const open = selectedId === c.id;
            const Dir = c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
            const secs = c.live ? c.elapsedS : (c.durationS ?? c.elapsedS);
            return (
              <tr key={c.id} data-call={c.id} data-status-of={status} aria-selected={open ? "true" : undefined} className={`relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-b border-line p-3 last:border-b-0 md:table-row md:p-0 ${open ? "bg-brand-bg" : "hover:bg-surface-2"}`}>
                <td className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 md:table-cell md:px-3 md:py-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Dir aria-hidden="true" className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <Link href={callsHref(base, query, c.id)} scroll={false} aria-current={open ? "true" : undefined} className="block truncate font-semibold text-ink after:absolute after:inset-0">
                        {c.who || t("ph.dir.inbound")}
                      </Link>
                      <span className="block text-sm text-muted">
                        {t(c.direction === "inbound" ? "calls6.dir.in" : "calls6.dir.out")}
                        {c.sandbox || c.simulated ? ` · ${t("ph.test")}` : ""}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="col-span-2 row-start-2 min-w-0 text-base text-ink [overflow-wrap:anywhere] md:table-cell md:px-3 md:py-3">{sentenceText(callSentence(c), words, why)}</td>
                <td className="col-start-1 row-start-3 md:table-cell md:px-3 md:py-3">
                  <StatusPill status={status}>{t(`calls6.st.${status}`)}</StatusPill>
                </td>
                <td className="col-start-2 row-start-3 text-right text-sm tabular-nums text-muted md:table-cell md:px-3 md:py-3 md:text-base md:text-ink">
                  {c.live ? <span className="font-semibold text-brand-text">{callClock(secs)}</span> : secs > 0 ? callClock(secs) : "–"}
                  <span className="md:hidden">{c.costPaise !== null ? ` · ${formatRupeesShort(c.costPaise)}` : ""}</span>
                </td>
                <td className="hidden text-right tabular-nums md:table-cell md:px-3 md:py-3">{c.costPaise !== null ? formatRupeesShort(c.costPaise) : "–"}</td>
                <td className="col-start-2 row-start-1 text-right text-sm text-muted md:table-cell md:px-3 md:py-3 md:text-left md:text-base md:whitespace-nowrap md:text-ink">
                  <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
