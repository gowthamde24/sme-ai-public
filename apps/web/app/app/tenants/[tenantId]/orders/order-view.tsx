import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  formatRupees,
  moneyHeld,
  type Member,
  type OrderDetail,
  type OrderState,
} from "@/lib/api/orders";
import { StatBox } from "@/components/v2/app/parts";
import { makeT, type Say, type Words } from "@/components/v2/app/words";
import { eventItem, kvList, kvTerm, kvValue, leadLine, link, listOrdered, metaLine, mutedText, noteBox, pageH1, pageH2, pillAmber, pillBrand, pillGreen } from "@/components/v2/app/ui";
import { formatDate } from "@/lib/api/quotes";

import { LocalTime } from "../../../local-time";

const CLOSED_NOT_OWED = ["declined", "cancelled", "expired"];

/** Who recorded an event, in words: a name when the workspace has one, otherwise the role. */
export function whoText(userId: string | null, members: Member[], t: Say = makeT()): string {
  if (userId === null) return t("orders.who.system");
  const m = members.find((x) => x.user_id === userId);
  if (!m) return t("orders.who.member");
  return m.display_name ? t("orders.who.named", { name: m.display_name, role: m.role }) : t("orders.who.role", { role: m.role });
}

/**
 * One order, in plain words: its state and outcome, the ledger (total, paid, refunded, balance), where it came from, and every event with who recorded it and when. Nothing here
 * decides anything: the forms (passed in) only offer what the rules allow, and the database decides again. Nothing on this page sends anything to anyone.
 */
export function OrderView({ tenantId, order, members, forms, words }: { tenantId: string; order: OrderDetail; members: Member[]; forms: ReactNode; words?: Words }) {
  const t = makeT(words);
  const base = `/app/tenants/${tenantId}`;
  const notOwed = CLOSED_NOT_OWED.includes(order.state);
  const held = moneyHeld(order);
  return (
    <section aria-labelledby="order-heading">
      <h1 id="order-heading" className={`${pageH1} flex flex-wrap items-center gap-3`}>
        <span className="font-mono">{t("orders.order_n", { n: order.order_no })}</span>
        <span className={order.outcome === "open" ? pillBrand : order.outcome === "won" ? pillGreen : pillAmber}>
          {t(`orders.outcome.${order.outcome}`)} · {t(`orders.state.${order.state}`)}
        </span>
      </h1>
      {order.lost_reason ? <p className={leadLine}>{t(`orders.lost.${order.lost_reason}`)}</p> : null}
      <p role="note" className={noteBox}>
        {t("orders.nothing_is_sent_by_this_system_2")}
      </p>

      {held > 0 ? (
        <p role="note" className="mt-4 flex items-center gap-2 rounded-lg border border-amber-text bg-amber-bg p-3 text-base font-semibold text-amber-text">
          <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
          {t("orders.held", { amount: formatRupees(held) })}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBox label={t("orders.order_total")} value={formatRupees(order.order_total_paise)} />
        <StatBox label={t("orders.received")} value={formatRupees(order.paid_paise)} />
        <StatBox label={t("orders.balance")} value={notOwed ? "–" : formatRupees(order.balance_paise)} />
        <StatBox label={t("orders.money_held")} value={formatRupees(held)} amber={held > 0} />
      </div>
      {notOwed ? <p className={mutedText}>{t("orders.balance_not_owed_the_order_is")}</p> : null}

      <h2 className={pageH2}>{t("orders.where_it_stands")}</h2>
      <ol aria-label={t("orders.the_steps_of_an_order")} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps(order).map((st) => (
          <li key={st.state} aria-current={st.current ? "step" : undefined} className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 ${st.current ? "border-brand-edge bg-brand-bg font-semibold" : st.reached ? "border-line bg-surface" : "border-dashed border-edge bg-surface-2 text-muted"}`}>
            {st.reached ? <CircleCheck className={`size-6 shrink-0 ${st.current ? "text-brand-text" : "text-green-text"}`} aria-hidden="true" /> : <CircleSlash className="size-6 shrink-0" aria-hidden="true" />}
            <span>
              {t(`orders.state.${st.state}`)}
              {st.reached ? null : <span className="block text-sm font-normal">{t("orders.not_reached")}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className={mutedText}>{t("orders.you_record_each_step_yourself_after")}</p>

      <h2 className={pageH2}>{t("orders.the_money")}</h2>
      <dl className={kvList}>
        <dt className={kvTerm}>{t("orders.state.advance_requested")}</dt>
        <dd className={kvValue}>{formatRupees(order.advance_paise)}</dd>
        <dt className={kvTerm}>{t("orders.refunded")}</dt>
        <dd className={kvValue}>{formatRupees(order.refunded_paise)}</dd>
        <dt className={kvTerm}>{t("orders.net_received")}</dt>
        <dd className={kvValue}>{formatRupees(order.net_paise)}</dd>
        <dt className={kvTerm}>{t("orders.quote_valid_until")}</dt>
        <dd className={kvValue}>{formatDate(order.valid_until)}</dd>
        <dt className={kvTerm}>{t("gst.customer")}</dt>
        <dd className={kvValue}>{order.customer_gstin ?? t("gst.none_short")}</dd>
        <dt className={kvTerm}>{t("gst.ours")}</dt>
        <dd className={kvValue}>{order.shop_gstin ?? t("gst.none_short")}</dd>
      </dl>

      <h2 className={pageH2}>{t("orders.what_to_record_next")}</h2>
      {forms}

      <h2 className={pageH2}>{t("orders.where_it_came_from")}</h2>
      <ul>
        <li>
          <Link href={`${base}/enquiries/${order.enquiry_id}?quote=${order.quote_id}`} className={link}>
            {t("orders.the_approved_quote")}
          </Link>
        </li>
        <li>
          <Link href={`${base}/enquiries/${order.enquiry_id}`} className={link}>
            {t("orders.the_enquiry")}
          </Link>
        </li>
        <li>
          <Link href={`${base}/leads/${order.lead_id}`} className={link}>
            {t("orders.the_lead")}
          </Link>
        </li>
      </ul>

      <h2 className={pageH2}>{t("orders.history")}</h2>
      <ol aria-label={t("orders.events_oldest_first")} className={listOrdered}>
        {order.events.map((e) => (
          <li key={e.id} className={eventItem}>
            <strong>{t(`orders.event.${e.type}`)}</strong>
            {e.amount_paise !== null ? <> · {formatRupees(e.amount_paise)}</> : null}
            {e.reason_code ? <> · {t(`orders.lost.${e.reason_code}`)}</> : null}
            <span className={metaLine}>
              {e.prior_state ? `${t(`orders.state.${e.prior_state}`)} → ` : ""}
              {t(`orders.state.${e.new_state}`)} · {t("orders.recorded_by", { who: whoText(e.recorded_by, members, t) })}
              {e.owner_approved_by ? `, ${t("orders.owner_approval", { who: whoText(e.owner_approved_by, members, t) })}` : ""} · {t("orders.it_happened")} <LocalTime iso={e.occurred_at} />; {t("orders.recorded")}{" "}
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
