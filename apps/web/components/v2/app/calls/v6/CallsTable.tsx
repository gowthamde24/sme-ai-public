import Link from "next/link";

import { StatusPill } from "@/components/v2/app/ds/StatusPill";
import type { CallRow } from "@/lib/api/calls";
import { callsHref, type CallsQuery } from "@/lib/calls/filter";
import { clockShort, rupeeCost } from "@/lib/calls/format";
import { callSentence, callStatus, sentenceText } from "@/lib/calls/status";
import { refuseWhy } from "@/lib/calls/view";

import { makeT, type Words } from "../../words";

/**
 * The table of calls (approved mock): Customer (the name, then "↙ in" or "↗ out") · What happened (the outcome sentence) · Status pill · Duration ("4:12") · Cost in rupees ("₹22.5") · Time. The whole row opens the call in the panel beside it (the name is the link, its stretched area covers
 * the row); the open row is peach. A live call shows its running length and "—" for the cost. On a phone each row is a card: the name and time on top, the sentence under them, then the status, length and cost. Server markup, no script.
 */
export type CallsTableProps = { words: Words; base: string; query: CallsQuery; items: readonly CallRow[]; selectedId: string | null; when: (iso: string) => string };

export function CallsTable({ words, base, query, items, selectedId, when }: CallsTableProps) {
  const t = makeT(words);
  const why = (reason: string | null) => words[`ph.why.${refuseWhy(reason)}`] ?? "";
  const head = "whitespace-nowrap px-3 py-[11px] text-left text-xs font-semibold text-muted";
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--v2-shadow)]" data-part="calls-table">
      <table className="block w-full border-collapse text-[13.5px] md:table">
        <caption className="sr-only">{t("calls6.table.caption")}</caption>
        <thead className="hidden border-b border-line md:table-header-group">
          <tr>
            <th scope="col" className={head}>{t("calls6.col.customer")}</th>
            <th scope="col" className={head}>{t("calls6.col.what")}</th>
            <th scope="col" className={head}>{t("calls6.col.status")}</th>
            <th scope="col" className={head}>{t("calls6.col.duration")}</th>
            <th scope="col" className={head}>{t("calls6.col.cost")}</th>
            <th scope="col" className={head}>{t("calls6.col.time")}</th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {items.map((c) => {
            const status = callStatus(c);
            const open = selectedId === c.id;
            const secs = c.live ? c.elapsedS : (c.durationS ?? c.elapsedS);
            const cell = `${open ? "md:bg-brand-bg" : ""} md:table-cell md:border-b md:border-line md:px-3 md:py-3 md:tabular-nums`;
            return (
              <tr key={c.id} data-call={c.id} data-status-of={status} aria-selected={open ? "true" : undefined} className={`relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-b border-line p-3 last:border-b-0 md:table-row md:border-0 md:p-0 md:last:[&>td]:border-b-0 ${open ? "bg-brand-bg" : "hover:bg-surface-2"}`}>
                <td className={`col-start-1 row-start-1 min-w-0 md:max-w-44 ${cell}`}>
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <Link href={callsHref(base, query, c.id)} scroll={false} aria-current={open ? "true" : undefined} className="min-w-0 truncate font-bold text-ink after:absolute after:inset-0">
                      {c.who || t("ph.dir.inbound")}
                    </Link>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted" title={t(c.direction === "inbound" ? "calls6.dir.in" : "calls6.dir.out")}>
                      <span aria-hidden="true">{c.direction === "inbound" ? "↙" : "↗"}</span>
                      <span className="max-xl:sr-only"> {t(c.direction === "inbound" ? "calls6.dir.in" : "calls6.dir.out")}</span>
                    </span>
                  </span>
                </td>
                <td className={`col-span-2 row-start-2 min-w-0 text-ink [overflow-wrap:anywhere] ${cell}`}>{sentenceText(callSentence(c), words, why)}</td>
                <td className={`col-start-1 row-start-3 md:whitespace-nowrap ${cell}`}>
                  <StatusPill status={status}>
                    {t(`calls6.st.${status}`)}
                  </StatusPill>
                </td>
                <td className={`col-start-2 row-start-3 text-right text-sm text-muted md:whitespace-nowrap md:text-left md:text-[13.5px] md:text-ink ${cell}`}>
                  {c.live ? <span className="font-semibold text-brand-text">{clockShort(secs)}</span> : clockShort(secs)}
                  <span className="md:hidden">{c.costPaise !== null && !c.live ? ` · ${rupeeCost(c.costPaise)}` : ""}</span>
                </td>
                <td className={`hidden md:whitespace-nowrap ${cell}`}>{c.costPaise !== null && !c.live ? rupeeCost(c.costPaise) : "—"}</td>
                <td className={`col-start-2 row-start-1 text-right text-sm text-muted md:whitespace-nowrap md:text-left md:text-[13.5px] md:text-ink ${cell}`}>
                  <time dateTime={c.createdAt} className="whitespace-nowrap">{when(c.createdAt)}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
