import Link from "next/link";

import { StatusPill } from "@/components/v2/app/ds/StatusPill";
import type { CallRow } from "@/lib/api/calls";
import { callsHref, type CallsQuery } from "@/lib/calls/filter";
import { clockShort, rupeeCost } from "@/lib/calls/format";
import { callSentence, callStatus, sentenceText } from "@/lib/calls/status";
import { refuseWhy } from "@/lib/calls/view";

import { callsOpen } from "@/lib/screens/flag";

import { makeT, type Words } from "../../words";
import { CallsTablePager } from "./CallsTablePager";
import { cardBox } from "../../Card";

export const CALLS_PAGE_SIZE = 20;

/**
 * The table of calls (approved mock): Customer (the name, then "↙ in" or "↗ out") · What happened (the outcome sentence) · Status pill · Duration ("4:12") · Cost in rupees ("₹22.5") · Time. The whole row opens the call in the panel beside it (the name is the link, its stretched area covers
 * the row); the open row is peach. A live call shows its running length and "—" for the cost. On a phone each row is a card: the name and time on top, the sentence under them, then the status, length and cost. Server markup, no script.
 */
export type CallsTableProps = { words: Words; base: string; query: CallsQuery; items: readonly CallRow[]; selectedId: string | null; when: (iso: string) => string };

export function CallsTable({ words, base, query, items, selectedId, when, pageSize = CALLS_PAGE_SIZE }: CallsTableProps & { pageSize?: number }) {
  const t = makeT(words);
  const why = (reason: string | null) => words[`ph.why.${refuseWhy(reason)}`] ?? "";
  const head = "whitespace-nowrap px-3 py-[11px] text-left text-xs font-semibold text-muted";
  if (callsOpen()) {
    const row = (c: CallRow) => {
      const status = callStatus(c);
      const open = selectedId === c.id;
      const s = callSentence(c);
      const raw = s.kind === "result" && s.result === "unclear" ? "" : sentenceText(s, words, why);
      const said = /^no clear result\.?$/i.test(raw.trim()) ? "" : raw; // the normal "nothing to say" is silent
      return (
        <li key={c.id} data-call={c.id} data-status-of={status} aria-selected={open ? "true" : undefined} className={`relative flex items-start gap-3 border-b border-line px-1 py-3.5 ${open ? "bg-surface-2" : ""}`}>
          <div className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <Link href={callsHref(base, query, c.id)} scroll={false} aria-current={open ? "true" : undefined} className="min-w-0 truncate text-[17px] font-semibold text-ink after:absolute after:inset-0">
                {c.who || t("ph.dir.inbound")}
              </Link>
              <span className="shrink-0 whitespace-nowrap text-sm text-muted">
                <span aria-hidden="true">{c.direction === "inbound" ? "↙" : "↗"}</span> {t(c.direction === "inbound" ? "calls6.dir.in" : "calls6.dir.out")}
              </span>
            </span>
            {said ? <p className="m-0 text-[15px] text-muted [overflow-wrap:anywhere]">{said}</p> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-sm text-muted">
            <time dateTime={c.createdAt} className="whitespace-nowrap">{when(c.createdAt)}</time>
            {c.live ? <span className="font-semibold text-brand-text">{clockShort(c.elapsedS)}</span> : status === "completed" ? null : <StatusPill status={status}>{t(`calls6.st.${status}`)}</StatusPill>}
          </div>
        </li>
      );
    };
    const first = items.slice(0, pageSize);
    const rest = items.slice(pageSize);
    return (
      <div data-part="calls-table" data-open="" className={cardBox}>
        <ul className="m-0 flex list-none flex-col p-0">{first.map(row)}</ul>
        {rest.length > 0 ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center py-3 text-[15px] font-semibold text-muted underline underline-offset-4 group-open:hidden [&::-webkit-details-marker]:hidden">{words["calls6.more"] ?? "Show more"}</summary>
            <ul className="m-0 flex list-none flex-col p-0">{rest.map(row)}</ul>
          </details>
        ) : null}
      </div>
    );
  }
  const renderRow = (c: CallRow) => {
    const status = callStatus(c);
    const open = selectedId === c.id;
    const secs = c.live ? c.elapsedS : (c.durationS ?? c.elapsedS);
    const cell = `${open ? "md:bg-surface-2" : ""} md:table-cell md:border-b md:border-line md:px-3 md:py-3 md:tabular-nums`;
    return (
      <tr key={c.id} data-call={c.id} data-status-of={status} aria-selected={open ? "true" : undefined} className={`relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 border-b border-line p-3 last:border-b-0 md:table-row md:border-0 md:p-0 md:last:[&>td]:border-b-0 ${open ? "bg-brand-bg" : "hover:bg-surface-2"}`}>
        <td className={`col-start-1 row-start-1 min-w-0 md:max-w-44 ${cell}`}>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <Link href={callsHref(base, query, c.id)} scroll={false} aria-current={open ? "true" : undefined} className="min-w-0 truncate font-bold text-ink after:absolute after:inset-0">
              {c.who || t("ph.dir.inbound")}
            </Link>
            <span className="shrink-0 whitespace-nowrap text-xs text-muted" title={t(c.direction === "inbound" ? "calls6.dir.in" : "calls6.dir.out")}>
              <span aria-hidden="true">{c.direction === "inbound" ? "↙" : "↗"}</span>
              <span data-call-dir-label="" className="max-xl:sr-only"> {t(c.direction === "inbound" ? "calls6.dir.in" : "calls6.dir.out")}</span>
            </span>
          </span>
        </td>
        <td className={`col-span-2 row-start-2 min-w-0 text-ink [overflow-wrap:anywhere] ${cell}`}>{sentenceText(callSentence(c), words, why)}</td>
        <td className={`col-start-1 row-start-3 md:whitespace-nowrap ${cell}`}>
          {/* the normal state is silent: only an exception (no answer, rejected, spam, live, passed to a person) gets a pill (simplification rule 4, owner 25 Nov) */}
          {status === "completed" ? null : (
            <StatusPill status={status}>
              {t(`calls6.st.${status}`)}
            </StatusPill>
          )}
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
  };
  const slices: CallRow[][] = [];
  for (let i = 0; i < items.length; i += pageSize) slices.push(items.slice(i, i + pageSize));
  const [firstSlice = [], ...restSlices] = slices;
  const thead = (
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
  );
  const firstBody = <tbody className="block md:table-row-group">{firstSlice.map(renderRow)}</tbody>;
  if (restSlices.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--v2-shadow)]" data-part="calls-table">
        <table className="block w-full border-collapse text-[13.5px] md:table">
          <caption className="sr-only">{t("calls6.table.caption")}</caption>
          {thead}
          {firstBody}
        </table>
      </div>
    );
  }
  return (
    <CallsTablePager
      caption={t("calls6.table.caption")}
      head={thead}
      first={firstBody}
      batches={restSlices.map((chunk, idx) => (
        <tbody key={idx} className="block md:table-row-group">
          {chunk.map(renderRow)}
        </tbody>
      ))}
      counts={restSlices.map((c) => c.length)}
      moreLabel={words["calls6.more"] ?? "Show more"}
    />
  );
}
