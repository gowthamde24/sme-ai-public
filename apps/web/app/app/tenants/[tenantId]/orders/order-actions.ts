"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  EVENT_LABELS,
  EVENT_TYPES,
  LOST_REASONS,
  MONEY_EVENTS,
  REFUSAL_TEXT,
  createOrder,
  parseRupees,
  recordEvent,
  type EventType,
  type LostReason,
} from "@/lib/api/orders";
import { requireUser } from "@/lib/auth/session";

import type { EnquiryActionState } from "../enquiries/actions";
import { FLAG_TEXT, occurredAt } from "./order-logic";

export type OrderActionState = EnquiryActionState;

const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
const trimmed = (formData: FormData, name: string) => field(formData, name).trim();

/** Every failure becomes a short sentence of OUR wording. The lifecycle's refusals are the API's fixed sentences, chosen by a closed reason code. */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    // the second factor and the owner-only rule are checked BEFORE the plain "your role does not allow this"
    if (error.code === "mfa_required")
      return "This needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more.";
    if (error.code === "owner_required") return "This needs the owner.";
    if (error.code === "order_event_refused") return REFUSAL_TEXT[error.reason ?? "OTHER"] ?? REFUSAL_TEXT.OTHER;
    if (error.status === 403) return "Your role does not allow this.";
    if (error.status === 404) return "This order is not available.";
    switch (error.code) {
      case "order_closed":
        return "This order is closed.";
      case "order_changed":
        return "The order changed while you were working on it. Reload it and try again.";
      case "order_exists":
        return "This quote already has an order.";
      case "quote_not_approved":
        return "Only an approved quote can become an order.";
      case "quote_expired":
        return "The quote has expired.";
      case "quote_has_order":
        return "This quote has a live order: lose or cancel the order first.";
      case "no_order_policy":
        return "No order policy is in force: the owner must publish one.";
      case "order_figures_invalid":
        return "This quote cannot become an order under the current order policy.";
      case "conflict":
        return OUT_OF_DATE;
    }
    if (error.status === 503) return "Orders are not available right now. Try again shortly.";
    if (error.status === 409) return "That is not possible right now. Reload the page and try again.";
    if (error.status === 422) return "That input was not accepted.";
  }
  return "Could not save. Try again.";
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
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId) || !isCanonicalUuid(quoteId)) return { ok: false, error: "This quote is not available." };
  const id = trimmed(formData, "order_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  let order;
  try {
    order = await createOrder(user.accessToken, tenantId, { id, quoteId });
  } catch (error) {
    return { ok: false, error: describe(error) };
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
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(orderId) || !(EVENT_TYPES as readonly string[]).includes(type)) return { ok: false, error: "This order is not available." };
  const kind = type as EventType;
  const id = trimmed(formData, "event_id");
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const when = occurredAt(trimmed(formData, "happened_on") || trimmed(formData, "today"), trimmed(formData, "today"), trimmed(formData, "rendered_at"));
  if (when === null) return { ok: false, error: "Choose the day it happened: today or an earlier day." };
  const input: Parameters<typeof recordEvent>[3] = { id, type: kind, occurredAt: when };
  if ((MONEY_EVENTS as readonly string[]).includes(kind)) {
    const amount = parseRupees(trimmed(formData, "amount"));
    if (amount === null) return { ok: false, error: "Enter the amount in rupees, for example 25,000 or 1,50,000.50." };
    const ledger = trimmed(formData, "ledger_id");
    if (!isCanonicalUuid(ledger)) return { ok: false, error: OUT_OF_DATE };
    input.amountPaise = amount;
    input.ledgerId = ledger;
  }
  if (kind === "customer_decline") {
    const reason = trimmed(formData, "reason");
    if (!(LOST_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "Choose why the customer declined." };
    input.reasonCode = reason as LostReason;
  }
  let result;
  try {
    result = await recordEvent(user.accessToken, tenantId, orderId, input);
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(orderPage(tenantId, orderId));
  revalidatePath(`/app/tenants/${tenantId}/orders`);
  const notes = result.flags.map((f) => FLAG_TEXT[f] ?? "The rules flagged this for the owner to review.");
  return { ok: true, message: [`Recorded: ${EVENT_LABELS[kind]}. Nothing was sent to anyone.`, ...notes].join(" ") };
}
