import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
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
  type OrderState,
} from "@/lib/api/orders";
import { StatBox } from "@/components/v2/app/parts";
import { eventItem, kvList, kvTerm, kvValue, leadLine, link, listOrdered, metaLine, mutedText, noteBox, pageH1, pageH2, pillAmber, pillBrand, pillGreen } from "@/components/v2/app/ui";
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
  const held = moneyHeld(order);
  return (
    <section aria-labelledby="order-heading">
      <h1 id="order-heading" className={`${pageH1} flex flex-wrap items-center gap-3`}>
        <span className="font-mono">Order {order.order_no}</span>
        <span className={order.outcome === "open" ? pillBrand : order.outcome === "won" ? pillGreen : pillAmber}>
          {OUTCOME_LABELS[order.outcome]} · {STATE_LABELS[order.state]}
        </span>
      </h1>
      {order.lost_reason ? <p className={leadLine}>{LOST_REASON_LABELS[order.lost_reason]}</p> : null}
      <p role="note" className={noteBox}>
        Nothing is sent by this system: every entry here is a record of something that happened outside it.
      </p>

      {held > 0 ? (
        <p role="note" className="mt-4 flex items-center gap-2 rounded-lg border border-amber-text bg-amber-bg p-3 text-base font-semibold text-amber-text">
          <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
          {HELD_TEXT(held)}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBox label="Order total" value={formatRupees(order.order_total_paise)} />
        <StatBox label="Received" value={formatRupees(order.paid_paise)} />
        <StatBox label="Balance" value={notOwed ? "–" : formatRupees(order.balance_paise)} />
        <StatBox label="Money held" value={formatRupees(held)} amber={held > 0} />
      </div>
      {notOwed ? <p className={mutedText}>Balance: not owed, the order is closed.</p> : null}

      <h2 className={pageH2}>Where it stands</h2>
      <ol aria-label="The steps of an order" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps(order).map((st) => (
          <li key={st.state} aria-current={st.current ? "step" : undefined} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 ${st.current ? "border-brand-edge bg-brand-bg font-semibold" : st.reached ? "border-line bg-surface" : "border-dashed border-edge bg-surface-2 text-muted"}`}>
            {st.reached ? <CircleCheck className={`size-6 shrink-0 ${st.current ? "text-brand-text" : "text-green-text"}`} aria-hidden="true" /> : <CircleSlash className="size-6 shrink-0" aria-hidden="true" />}
            <span>
              {STATE_LABELS[st.state]}
              {st.reached ? null : <span className="block text-sm font-normal">Not reached</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className={mutedText}>You record each step yourself, after it happens outside this app.</p>

      <h2 className={pageH2}>The money</h2>
      <dl className={kvList}>
        <dt className={kvTerm}>Advance asked for</dt>
        <dd className={kvValue}>{formatRupees(order.advance_paise)}</dd>
        <dt className={kvTerm}>Refunded</dt>
        <dd className={kvValue}>{formatRupees(order.refunded_paise)}</dd>
        <dt className={kvTerm}>Net received</dt>
        <dd className={kvValue}>{formatRupees(order.net_paise)}</dd>
        <dt className={kvTerm}>Quote valid until</dt>
        <dd className={kvValue}>{formatDate(order.valid_until)}</dd>
      </dl>

      <h2 className={pageH2}>What to record next</h2>
      {forms}

      <h2 className={pageH2}>Where it came from</h2>
      <ul>
        <li>
          <Link href={`${base}/enquiries/${order.enquiry_id}?quote=${order.quote_id}`} className={link}>
            The approved quote
          </Link>
        </li>
        <li>
          <Link href={`${base}/enquiries/${order.enquiry_id}`} className={link}>
            The enquiry
          </Link>
        </li>
        <li>
          <Link href={`${base}/leads/${order.lead_id}`} className={link}>
            The lead
          </Link>
        </li>
      </ul>

      <h2 className={pageH2}>History</h2>
      <ol aria-label="Events, oldest first" className={listOrdered}>
        {order.events.map((e) => (
          <li key={e.id} className={eventItem}>
            <strong>{EVENT_LABELS[e.type]}</strong>
            {e.amount_paise !== null ? <> · {formatRupees(e.amount_paise)}</> : null}
            {e.reason_code ? <> · {LOST_REASON_LABELS[e.reason_code]}</> : null}
            <span className={metaLine}>
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

const PATH: readonly OrderState[] = ["quote_sent", "accepted", "advance_requested", "advance_paid", "in_preparation", "dispatched", "delivered", "closed_paid"];
const TERMINAL: readonly OrderState[] = ["declined", "expired", "cancelled"];
/** The steps of the order for the picture: the usual path, with the end replaced by how this order really ended (declined, expired, cancelled). A step is reached when an event of this order put it in that state. */
function steps(order: OrderDetail): { state: OrderState; reached: boolean; current: boolean }[] {
  const visited = new Set<OrderState>([order.state, ...order.events.map((e) => e.new_state)]);
  const path = TERMINAL.includes(order.state) ? [...PATH.slice(0, -1), order.state] : [...PATH];
  const rank = (s: OrderState) => PATH.indexOf(s);
  const furthest = Math.max(-1, ...[...visited].map((s) => rank(s)));
  return path.map((state) => ({ state, reached: visited.has(state) || (rank(state) !== -1 && rank(state) < furthest), current: state === order.state }));
}
