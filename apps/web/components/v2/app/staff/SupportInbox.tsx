import Link from "next/link";

import { count, waiting } from "@/lib/staff/format";
import type { TicketList } from "@/lib/staff/types";
import { CHANNEL, PRIORITY, SUP, TICKET_STATUS } from "@/lib/staff/words";

const CHIPS = ["active", "open", "waiting", "closed"] as const;
export type InboxStatus = (typeof CHIPS)[number];
export const isInboxStatus = (v: unknown): v is InboxStatus => typeof v === "string" && (CHIPS as readonly string[]).includes(v);

/**
 * The support inbox (owner and support): status chips (Active = open + waiting, Open, Waiting for the shop, Closed) as plain links, then the tickets the API sorted (urgent first, then the longest waiting). Each row opens its thread.
 * A server component: the chips are addresses (`?status=`), no script.
 */
export function SupportInbox({ list, status, keep }: { list: TicketList; status: InboxStatus; keep: string }) {
  const sep = keep ? "&" : "?";
  const rest = list.total - list.items.length;
  return (
    <section className="sc-card" data-part="inbox" aria-labelledby="sc-inbox-h">
      <div className="sc-ch">
        <h3 id="sc-inbox-h">{SUP.inboxTitle} · {count(list.total)}</h3>
        <nav className="sc-chips" aria-label="Ticket status">
          {CHIPS.map((c) => (
            <Link key={c} className="sc-chip" href={`/staff/support${keep}${c === "active" ? "" : `${sep}status=${c}`}`} aria-current={c === status ? "true" : undefined} data-status={c}>
              {TICKET_STATUS[c]}
            </Link>
          ))}
        </nav>
      </div>
      {list.items.length === 0 ? (
        <p className="sc-empty">{SUP.inboxNone}</p>
      ) : (
        list.items.map((t) => (
          <Link key={t.id} className="sc-tk sc-tklink" href={`/staff/support/${encodeURIComponent(t.id)}${keep}`} data-part="ticket" data-status={t.status}>
            <span className="sc-pr" data-p={t.priority}>{PRIORITY[t.priority]}</span>
            <div className="sc-tt">
              <b>{t.businessName}</b>
              <span>{t.subject}</span>
            </div>
            <span className="sc-chn">{CHANNEL[t.channel] ?? t.channel} · {waiting(t.waitingMinutes)}</span>
            <span className="sc-as">{t.assignee ?? "—"}</span>
          </Link>
        ))
      )}
      {rest > 0 ? <div className="sc-more">{SUP.inboxMore(rest)}</div> : null}
    </section>
  );
}
