import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the order endpoints of OUR API (rehearsal step 4; ADR 0021).
 *
 * An order is a RECORD of what happened outside this system: a quote was sent, a customer accepted, money arrived, goods left. Nothing here sends anything, moves money or
 * decides a state: the figures are the approved quote's, the state is the ledger's, and the database refuses anything the lifecycle's rules do not allow. A body that does
 * not match the contract is an error, never rendered. Money is integer paise.
 */
export const ORDER_STATES = [
  "quote_approved", "quote_sent", "accepted", "advance_requested", "advance_paid", "in_preparation", "dispatched", "delivered", "closed_paid", "declined", "expired", "cancelled",
] as const; // fmt: skip
export type OrderState = (typeof ORDER_STATES)[number];
/** The state in OUR words. "Marked as sent" because a person says they sent it: this system sends nothing. */
export const STATE_LABELS: Record<OrderState, string> = {
  quote_approved: "Quote approved",
  quote_sent: "Quote marked as sent",
  accepted: "Accepted by the customer",
  advance_requested: "Advance asked for",
  advance_paid: "Advance received",
  in_preparation: "In preparation",
  dispatched: "Dispatched",
  delivered: "Delivered",
  closed_paid: "Closed, fully paid",
  declined: "Declined by the customer",
  expired: "Expired",
  cancelled: "Cancelled",
};
export const OUTCOMES = ["open", "won", "lost", "cancelled", "expired"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = { open: "Open", won: "Won", lost: "Lost", cancelled: "Cancelled", expired: "Expired" };

export const EVENT_TYPES = [
  "send_quote", "customer_accept", "customer_decline", "expire", "request_advance", "record_payment", "start_preparation", "dispatch", "deliver", "cancel", "record_refund",
] as const; // fmt: skip
export type EventType = (typeof EVENT_TYPES)[number];
export const LEDGER_TYPES = ["created", ...EVENT_TYPES] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];
/** What each form says it records. Every one is a record of something that already happened. */
export const EVENT_LABELS: Record<LedgerType, string> = {
  created: "Order started from the approved quote",
  send_quote: "I sent the quote",
  customer_accept: "The customer accepted",
  customer_decline: "The customer declined",
  expire: "The quote expired",
  request_advance: "I asked for the advance",
  record_payment: "A payment was received",
  start_preparation: "Preparation started",
  dispatch: "The goods were dispatched",
  deliver: "The goods were delivered",
  cancel: "Cancel this order",
  record_refund: "A refund was given",
};
export const MONEY_EVENTS: readonly EventType[] = ["record_payment", "record_refund"];
/** Events that need the person's authenticator app (the database checks again). */
export const SECOND_FACTOR_EVENTS: readonly EventType[] = ["record_payment", "record_refund", "cancel"];
/** What a Sales user may record (the database decides again): no money, no cancellation, no refund. */
const SALES_EVENTS: readonly EventType[] = ["send_quote", "customer_accept", "customer_decline", "expire", "request_advance", "start_preparation", "dispatch", "deliver"];

export const LOST_REASONS = ["price", "timing", "bought_elsewhere", "no_response", "requirement_changed", "product_unavailable", "credit_terms", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: "The price",
  timing: "The timing",
  bought_elsewhere: "They bought elsewhere",
  no_response: "No response",
  requirement_changed: "Their requirement changed",
  product_unavailable: "The product was not available",
  credit_terms: "The credit terms",
  other: "Another reason",
};

/**
 * The lifecycle's refusals in plain words. These are the API's own fixed sentences (app/main.py ORDER_REASON_TEXT; a test pins the two tables equal): the closed reason code comes
 * back with the refusal and nothing else from the data layer is ever shown.
 */
export const REFUSAL_TEXT: Record<string, string> = {
  ILLEGAL_TRANSITION: "That cannot happen at this stage of the order.",
  QUOTE_NOT_EXPIRED: "The quote has not expired yet.",
  QUOTE_EXPIRED: "The quote has expired.",
  CANCEL_WINDOW_CLOSED: "It is too late to cancel this order.",
  ADVANCE_NOT_PAID: "The advance has not been paid.",
  DUPLICATE_PAYMENT_ID: "That payment was already recorded.",
  DUPLICATE_REFUND_ID: "That refund was already recorded.",
  OVERPAYMENT: "That payment would pay more than the order's total.",
  REFUND_EXCEEDS_PAID: "That refund is more than has been paid.",
  CLOSED_UNPAID: "A closed order must be fully paid.",
  INVALID_ADVANCE: "The order's advance does not fit its policy.",
  INVALID_CANCEL_WINDOW: "The order's cancel window is not valid.",
  INVALID_STATE: "The order is in a state the rules do not know.",
  INVALID_EVENT: "The rules do not know that event.",
  OUT_OF_RANGE: "A value is outside the allowed range.",
  OTHER: "The order rules refuse this event.",
};

export interface OrderEvent {
  id: string;
  seq: number;
  type: LedgerType;
  prior_state: OrderState | null;
  new_state: OrderState;
  amount_paise: number | null;
  ledger_id: string | null;
  occurred_at: string;
  reason_code: LostReason | null;
  owner_approved_by: string | null;
  recorded_by: string | null;
  recorded_at: string;
  engine_version: string | null;
  canonical_hash: string | null;
}
export interface Order {
  id: string;
  order_no: number;
  quote_id: string;
  enquiry_id: string;
  requirement_id: string;
  lead_id: string;
  state: OrderState;
  outcome: Outcome;
  order_total_paise: number;
  advance_paise: number;
  valid_until: string;
  policy_version_id: string;
  created_at: string;
  closed_at: string | null;
  paid_paise: number;
  refunded_paise: number;
  net_paise: number;
  balance_paise: number;
  event_count: number;
  lost_reason: LostReason | null;
}
export interface OrderDetail extends Order {
  events: OrderEvent[];
  allowed_next_events: EventType[];
}
export interface OrderPage {
  items: Order[];
  next_cursor: string | null;
}
export interface EventResult {
  event_id: string;
  order_id: string;
  seq: number;
  state: OrderState;
  prior_state: OrderState | null;
  outcome: Outcome;
  replayed: boolean;
  allowed_next_events: EventType[];
  flags: string[];
  paid_total: number | null;
  balance_due: number | null;
}
export interface Member {
  user_id: string;
  role: string;
  display_name: string | null;
}

// ----------------------------------------------------------------------------- money and dates
/** Integer paise as rupees with Indian digit grouping (1,50,000.00); decimals always shown. Integers only: anything else is a contract error. */
export function formatRupees(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new ApiContractError("Unexpected amount in an order response.");
  const whole = String(Math.floor(paise / 100));
  let grouped = whole;
  if (whole.length > 3) {
    let head = whole.slice(0, -3);
    const groups: string[] = [];
    while (head.length > 2) {
      groups.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) groups.unshift(head);
    grouped = [...groups, whole.slice(-3)].join(",");
  }
  return `₹${grouped}.${String(paise % 100).padStart(2, "0")}`;
}

/** What a person types ("1,50,000", "40000.50", "₹ 500") as integer paise, or null when it is not a plain amount of at most two decimals. */
export function parseRupees(text: string): number | null {
  const cleaned = text.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return paise >= 1 && paise <= 1_000_000_000 ? paise : null;
}

// ----------------------------------------------------------------------------- money still held on a closed order
/** What a lost, cancelled or expired order still holds: the NET received (paid less refunded). A won order is not "closed with money": it is paid for. Zero when nothing is held. */
export function moneyHeld(order: Pick<Order, "outcome" | "net_paise">): number {
  return (order.outcome === "lost" || order.outcome === "cancelled" || order.outcome === "expired") && order.net_paise > 0 ? order.net_paise : 0;
}
/** The permanent line for an order that holds money after it closed (a refund may be owed). */
export const HELD_TEXT = (paise: number): string => `Money still held: ${formatRupees(paise)}. A refund may be owed to the customer.`;

// ----------------------------------------------------------------------------- who may record what (guidance for the screen; the database decides again)
export interface OfferInput {
  role: string;
  allowed: readonly EventType[];
  order: Pick<Order, "paid_paise" | "refunded_paise">;
}
/** The event forms to show: the API's guidance for this order, narrowed to what this role may do. A refusal from the API is still shown plainly if a form is used anyway. */
export function eventsOffered({ role, allowed, order }: OfferInput): EventType[] {
  const funded = order.paid_paise - order.refunded_paise > 0;
  if (role === "owner") return [...allowed];
  if (role === "admin") return allowed.filter((e) => e !== "record_refund" && !(e === "cancel" && funded));
  if (role === "sales") return allowed.filter((e) => SALES_EVENTS.includes(e));
  return [];
}

// ----------------------------------------------------------------------------- parsing
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an order response.`);
}
const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(k));
const strOrNull = (r: Rec, k: string): string | null => (r[k] === null ? null : str(r, k));
const int = (r: Rec, k: string): number => (typeof r[k] === "number" && Number.isSafeInteger(r[k]) ? (r[k] as number) : bad(k));
const intOrNull = (r: Rec, k: string): number | null => (r[k] === null ? null : int(r, k));
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k));
function oneOf<T extends string>(r: Rec, k: string, allowed: readonly T[]): T {
  const v = r[k];
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(k);
}
const oneOfOrNull = <T extends string>(r: Rec, k: string, allowed: readonly T[]): T | null => (r[k] === null ? null : oneOf(r, k, allowed));
const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(what));
const strings = (v: unknown, what: string): string[] => list(v, what).map((s) => (typeof s === "string" ? s : bad(what)));

function parseEvent(json: unknown): OrderEvent {
  if (!isRecord(json)) return bad("event");
  return {
    id: str(json, "id"),
    seq: int(json, "seq"),
    type: oneOf(json, "type", LEDGER_TYPES),
    prior_state: oneOfOrNull(json, "prior_state", ORDER_STATES),
    new_state: oneOf(json, "new_state", ORDER_STATES),
    amount_paise: intOrNull(json, "amount_paise"),
    ledger_id: strOrNull(json, "ledger_id"),
    occurred_at: str(json, "occurred_at"),
    reason_code: oneOfOrNull(json, "reason_code", LOST_REASONS),
    owner_approved_by: strOrNull(json, "owner_approved_by"),
    recorded_by: strOrNull(json, "recorded_by"),
    recorded_at: str(json, "recorded_at"),
    engine_version: strOrNull(json, "engine_version"),
    canonical_hash: strOrNull(json, "canonical_hash"),
  };
}

export function parseOrder(json: unknown): Order {
  if (!isRecord(json)) return bad("order");
  return {
    id: str(json, "id"),
    order_no: int(json, "order_no"),
    quote_id: str(json, "quote_id"),
    enquiry_id: str(json, "enquiry_id"),
    requirement_id: str(json, "requirement_id"),
    lead_id: str(json, "lead_id"),
    state: oneOf(json, "state", ORDER_STATES),
    outcome: oneOf(json, "outcome", OUTCOMES),
    order_total_paise: int(json, "order_total_paise"),
    advance_paise: int(json, "advance_paise"),
    valid_until: str(json, "valid_until"),
    policy_version_id: str(json, "policy_version_id"),
    created_at: str(json, "created_at"),
    closed_at: strOrNull(json, "closed_at"),
    paid_paise: int(json, "paid_paise"),
    refunded_paise: int(json, "refunded_paise"),
    net_paise: int(json, "net_paise"),
    balance_paise: int(json, "balance_paise"),
    event_count: int(json, "event_count"),
    lost_reason: oneOfOrNull(json, "lost_reason", LOST_REASONS),
  };
}

export function parseOrderDetail(json: unknown): OrderDetail {
  if (!isRecord(json)) return bad("order");
  return {
    ...parseOrder(json),
    events: list(json.events, "events").map(parseEvent),
    allowed_next_events: strings(json.allowed_next_events, "allowed_next_events").map((e) =>
      (EVENT_TYPES as readonly string[]).includes(e) ? (e as EventType) : bad("allowed_next_events"),
    ),
  };
}

export function parseOrderPage(json: unknown): OrderPage {
  if (!isRecord(json)) return bad("order list");
  return { items: list(json.items, "items").map(parseOrder), next_cursor: strOrNull(json, "next_cursor") };
}

export function parseEventResult(json: unknown): EventResult {
  if (!isRecord(json)) return bad("event result");
  return {
    event_id: str(json, "event_id"),
    order_id: str(json, "order_id"),
    seq: int(json, "seq"),
    state: oneOf(json, "state", ORDER_STATES),
    prior_state: oneOfOrNull(json, "prior_state", ORDER_STATES),
    outcome: oneOf(json, "outcome", OUTCOMES),
    replayed: bool(json, "replayed"),
    allowed_next_events: strings(json.allowed_next_events, "allowed_next_events").map((e) =>
      (EVENT_TYPES as readonly string[]).includes(e) ? (e as EventType) : bad("allowed_next_events"),
    ),
    flags: strings(json.flags, "flags"),
    paid_total: intOrNull(json, "paid_total"),
    balance_due: intOrNull(json, "balance_due"),
  };
}

export function parseMembers(json: unknown): Member[] {
  if (!isRecord(json)) return bad("members");
  return list(json.members, "members").map((m) => {
    if (!isRecord(m)) return bad("member");
    return { user_id: str(m, "user_id"), role: str(m, "role"), display_name: strOrNull(m, "display_name") };
  });
}

// ----------------------------------------------------------------------------- requests (ids are checked BEFORE they reach a path)
function checked(...ids: string[]): void {
  for (const id of ids) if (!isCanonicalUuid(id)) throw new ApiContractError("id");
}
const base = (tenantId: string) => `/v1/tenants/${tenantId}`;
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export async function fetchOrders(accessToken: string, tenantId: string, opts: { limit?: number; cursor?: string | null; quoteId?: string } = {}): Promise<OrderPage> {
  checked(tenantId);
  const query = new URLSearchParams({ limit: String(opts.limit ?? 20) });
  if (opts.quoteId !== undefined) {
    checked(opts.quoteId);
    query.set("quote_id", opts.quoteId); // only the orders of this quote (the quote screen asks for its own order)
  }
  if (opts.cursor) query.set("cursor", opts.cursor);
  return parseOrderPage(await apiRequest(`${base(tenantId)}/orders?${query}`, accessToken));
}

export async function fetchOrder(accessToken: string, tenantId: string, orderId: string): Promise<OrderDetail> {
  checked(tenantId, orderId);
  return parseOrderDetail(await apiRequest(`${base(tenantId)}/orders/${orderId}`, accessToken));
}

export async function fetchMembers(accessToken: string, tenantId: string): Promise<Member[]> {
  checked(tenantId);
  return parseMembers(await apiRequest(`${base(tenantId)}/members`, accessToken));
}

/** Start tracking an APPROVED quote as an order. The figures are the quote's, copied by the database: nothing here supplies an amount. */
export async function createOrder(accessToken: string, tenantId: string, input: { id: string; quoteId: string }): Promise<OrderDetail> {
  checked(tenantId, input.id, input.quoteId);
  return parseOrderDetail(await apiRequest(`${base(tenantId)}/orders`, accessToken, post({ id: input.id, quote_id: input.quoteId })));
}

export interface RecordEventInput {
  id: string;
  type: EventType;
  occurredAt?: string;
  amountPaise?: number;
  ledgerId?: string;
  reasonCode?: LostReason;
}

/** One event a PERSON reports. The body has the person's inputs only: no total, no state, no approver and no override. */
export async function recordEvent(accessToken: string, tenantId: string, orderId: string, input: RecordEventInput): Promise<EventResult> {
  checked(tenantId, orderId, input.id);
  if (input.ledgerId !== undefined) checked(input.ledgerId);
  const body: Record<string, unknown> = { id: input.id, type: input.type };
  if (input.occurredAt !== undefined) body.occurred_at = input.occurredAt;
  if (input.amountPaise !== undefined) body.amount_paise = input.amountPaise;
  if (input.ledgerId !== undefined) body.ledger_id = input.ledgerId;
  if (input.reasonCode !== undefined) body.reason_code = input.reasonCode;
  return parseEventResult(await apiRequest(`${base(tenantId)}/orders/${orderId}/events`, accessToken, post(body)));
}
