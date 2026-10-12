"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  EVENT_TYPES,
  LOST_REASONS,
  MONEY_EVENTS,
  createOrder,
  parseRupees,
  recordEvent,
  type EventType,
  type LostReason,
} from "@/lib/api/orders";
import { serverT } from "@/i18n/server-t";
import type { Say } from "@/components/v2/app/words";
import { requireUser } from "@/lib/auth/session";

import type { EnquiryActionState } from "../enquiries/actions";
import { FLAG_TEXT, occurredAt } from "./order-logic";

/** The lifecycle's reason codes of a refused event (their sentences are the dictionary's `orders.refusal.*`). */
const REFUSAL_CODES = { ILLEGAL_TRANSITION: 1, QUOTE_NOT_EXPIRED: 1, QUOTE_EXPIRED: 1, CANCEL_WINDOW_CLOSED: 1, ADVANCE_NOT_PAID: 1, DUPLICATE_PAYMENT_ID: 1, DUPLICATE_REFUND_ID: 1, OVERPAYMENT: 1, REFUND_EXCEEDS_PAID: 1, CLOSED_UNPAID: 1, INVALID_ADVANCE: 1, INVALID_CANCEL_WINDOW: 1, INVALID_STATE: 1, INVALID_EVENT: 1, OUT_OF_RANGE: 1, OTHER: 1 } as const;

export type OrderActionState = EnquiryActionState;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes a short sentence of OUR wording. The lifecycle's refusals are the API's fixed sentences, chosen by a closed reason code. */
function describe(error: unknown, t: Say): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    // the second factor and the owner-only rule are checked BEFORE the plain "your role does not allow this"
    if (error.code === "mfa_required")
      return t("orders.err.mfa");
    if (error.code === "owner_required") return t("orders.err.owner");
    if (error.code === "order_event_refused") return t(`orders.refusal.${error.reason && error.reason in REFUSAL_CODES ? error.reason : "OTHER"}`);
    if (error.status === 403) return t("orders.err.role");
    if (error.status === 404) return t("orders.err.order_unavailable");
    switch (error.code) {
      case "order_closed":
        return t("orders.err.closed");
      case "order_changed":
        return t("orders.err.changed");
      case "order_exists":
        return t("orders.err.exists");
      case "quote_not_approved":
        return t("orders.err.not_approved");
      case "quote_expired":
        return t("orders.err.quote_expired");
      case "quote_has_order":
        return t("orders.err.has_order");
      case "no_order_policy":
        return t("orders.err.no_policy");
      case "order_figures_invalid":
        return t("orders.err.figures");
      case "conflict":
        return t("orders.err.out_of_date");
    }
    if (error.status === 503) return t("orders.err.unavailable");
    if (error.status === 409) return t("orders.err.conflict");
    if (error.status === 422) return t("orders.err.invalid");
  }
  return t("orders.err.generic");
}

const orderPage = (tenantId: string, orderId: string) => `/app/tenants/${tenantId}/orders/${orderId}`;

/** Start an order from an APPROVED quote (an owner or an admin with their authenticator app). It copies the quote's figures; nothing is sent to anyone. */
export async function startOrderAction(
  tenantId: string,
  enquiryId: string,
  quoteId: string,
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const user = await requireUser();
  const t = await serverT(["orders."]);
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: t("orders.err.quote_unavailable") };
  const id = trimmed(formData, "order_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: t("orders.err.out_of_date") };
  let order;
  try {
    order = await createOrder(user.accessToken, tenantId, { id, quoteId });
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}/enquiries/${enquiryId}`);
  revalidatePath(`/app/tenants/${tenantId}/orders`);
  redirect(orderPage(tenantId, order.id));
}

/**
 * A person records ONE event: something that already happened outside this system. The person's inputs are the event id (a retry sends the same one), the amount and the day of a
 * money event, a ledger id the page made, and a decline's reason. There is no field for a total, a state, an approver or an override: the database derives those.
 */
export async function recordEventAction(
  tenantId: string,
  orderId: string,
  type: string,
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const user = await requireUser();
  const t = await serverT(["orders."]);
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(orderId) || !(EVENT_TYPES as readonly string[]).includes(type)) return { ok: false, error: t("orders.err.order_unavailable") };
  const kind = type as EventType;
  const id = trimmed(formData, "event_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: t("orders.err.out_of_date") };
  const when = occurredAt(trimmed(formData, "happened_on") || trimmed(formData, "today"), trimmed(formData, "today"), trimmed(formData, "rendered_at"));
  if (when === null) return { ok: false, error: t("orders.err.choose_day") };
  const input: Parameters<typeof recordEvent>[3] = { id, type: kind, occurredAt: when };
  if ((MONEY_EVENTS as readonly string[]).includes(kind)) {
    const amount = parseRupees(trimmed(formData, "amount"));
    if (amount === null) return { ok: false, error: t("orders.err.amount") };
    const ledger = trimmed(formData, "ledger_id");
    if (!isCanonicalUuid(ledger)) return { ok: false, error: t("orders.err.out_of_date") };
    input.amountPaise = amount;
    input.ledgerId = ledger;
  }
  if (kind === "customer_decline") {
    const reason = trimmed(formData, "reason");
    if (!(LOST_REASONS as readonly string[]).includes(reason)) return { ok: false, error: t("orders.err.why_declined") };
    input.reasonCode = reason as LostReason;
  }
  let result;
  try {
    result = await recordEvent(user.accessToken, tenantId, orderId, input);
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(orderPage(tenantId, orderId));
  revalidatePath(`/app/tenants/${tenantId}/orders`);
  const notes = result.flags.map((f) => t(f in FLAG_TEXT ? `orders.flag.${f}` : "orders.flag.other"));
  return { ok: true, message: [t("orders.recorded_event", { event: t(`orders.event.${kind}`) }), ...notes].join(" ") };
}
