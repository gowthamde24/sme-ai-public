import Link from "next/link";
import type { ReactNode } from "react";

import {
  EVENT_LABELS,
  LOST_REASON_LABELS,
  OUTCOME_LABELS,
  HELD_TEXT,
  STATE_LABELS,
  formatRupees,
  moneyHeld,
  type Member,
  type OrderDetail,
} from "@/lib/api/orders";
import { formatDate } from "@/lib/api/quotes";

import { LocalTime } from "../../../local-time";

const CLOSED_NOT_OWED = ["declined", "cancelled", "expired"];

/** Who recorded an event, in words: a name when the workspace has one, otherwise the role. */
export function whoText(userId: string | null, members: Member[]): string {
  if (userId === null) return "The system";
  const m = members.find((x) => x.user_id === userId);
  if (!m) return "A team member";
  return m.display_name ? `${m.display_name} (${m.role})` : `A ${m.role}`;
}

/**
 * One order, in plain words: its state and outcome, the ledger (total, paid, refunded, balance), where it came from, and every event with who recorded it and when. Nothing here
 * decides anything: the forms (passed in) only offer what the rules allow, and the database decides again. Nothing on this page sends anything to anyone.
 */
export function OrderView({ tenantId, order, members, forms }: { tenantId: string; order: OrderDetail; members: Member[]; forms: ReactNode }) {
  const base = `/app/tenants/${tenantId}`;
  const notOwed = CLOSED_NOT_OWED.includes(order.state);
  return (
    <section aria-labelledby="order-heading">
      <h1 id="order-heading">Order {order.order_no}</h1>
      <p>
        <strong>{OUTCOME_LABELS[order.outcome]}</strong> · {STATE_LABELS[order.state]}
        {order.lost_reason ? ` · ${LOST_REASON_LABELS[order.lost_reason]}` : ""}
      </p>
      <p role="note" className="notice">
        Nothing is sent by this system: every entry here is a record of something that happened outside it.
      </p>

      {moneyHeld(order) > 0 ? (
        <p role="note" className="notice">
          {HELD_TEXT(moneyHeld(order))}
        </p>
      ) : null}

      <h2>The money</h2>
      <dl className="summary">
        <dt>Order total</dt>
        <dd>{formatRupees(order.order_total_paise)}</dd>
        <dt>Advance asked for</dt>
        <dd>{formatRupees(order.advance_paise)}</dd>
        <dt>Received</dt>
        <dd>{formatRupees(order.paid_paise)}</dd>
        <dt>Refunded</dt>
        <dd>{formatRupees(order.refunded_paise)}</dd>
        <dt>Net received</dt>
        <dd>{formatRupees(order.net_paise)}</dd>
        <dt>Balance</dt>
        <dd>{notOwed ? "Not owed: the order is closed" : formatRupees(order.balance_paise)}</dd>
        <dt>Quote valid until</dt>
        <dd>{formatDate(order.valid_until)}</dd>
      </dl>

      <h2>Where it came from</h2>
      <ul>
        <li>
          <Link href={`${base}/enquiries/${order.enquiry_id}?quote=${order.quote_id}`} className="tap">
            The approved quote
          </Link>
        </li>
        <li>
          <Link href={`${base}/enquiries/${order.enquiry_id}`} className="tap">
            The enquiry
          </Link>
        </li>
        <li>
          <Link href={`${base}/leads/${order.lead_id}`} className="tap">
            The lead
          </Link>
        </li>
      </ul>

      <h2>What to record next</h2>
      {forms}

      <h2>History</h2>
      <ol aria-label="Events, oldest first">
        {order.events.map((e) => (
          <li key={e.id} className="card">
            <strong>{EVENT_LABELS[e.type]}</strong>
            {e.amount_paise !== null ? <> · {formatRupees(e.amount_paise)}</> : null}
            {e.reason_code ? <> · {LOST_REASON_LABELS[e.reason_code]}</> : null}
            <br />
            <span className="hint">
              {e.prior_state ? `${STATE_LABELS[e.prior_state]} → ` : ""}
              {STATE_LABELS[e.new_state]} · recorded by {whoText(e.recorded_by, members)}
              {e.owner_approved_by ? `, with the owner's approval (${whoText(e.owner_approved_by, members)})` : ""} · it happened <LocalTime iso={e.occurred_at} />; recorded{" "}
              <LocalTime iso={e.recorded_at} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
