import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the quote endpoints of OUR API (T009).
 *
 * A quote's figures are the pinned engine's, verified by the database: nothing here computes a price, a tax or a total, and nothing here is
 * ever sent to a customer. The text of an approved quote is for a PERSON to copy; this application sends nothing. A body that does not match the
 * contract is an error, never rendered. Money is integer paise.
 */
export const OUTCOMES = ["draft", "approved", "rejected", "withdrawn", "superseded"] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** What a person sees. Only a person's approval says "Approved"; no quote ever says "Sent". */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  draft: "Draft",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  superseded: "Replaced",
};
export const STATUSES = ["draft", "approved", "rejected", "superseded"] as const;
export const CUSTOMER_KINDS = ["new", "repeat"] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];
export const CUSTOMER_KIND_LABELS: Record<CustomerKind, string> = { new: "New customer", repeat: "Repeat customer" };
export const SALE_UNITS = ["piece", "set"] as const;
export type SaleUnit = (typeof SALE_UNITS)[number];
export const REJECT_CODES = ["wrong_prices", "customer_changed", "duplicate", "withdrawn", "other"] as const;
export type RejectCode = (typeof REJECT_CODES)[number];
export const REJECT_LABELS: Record<RejectCode, string> = {
  wrong_prices: "The prices were wrong",
  customer_changed: "The customer changed the order",
  duplicate: "It duplicates another quote",
  withdrawn: "I am withdrawing my draft",
  other: "Another reason",
};
export const WITHDRAW_CODES = ["price_changed", "customer_cancelled", "entered_in_error", "other"] as const;
export type WithdrawCode = (typeof WITHDRAW_CODES)[number];
export const WITHDRAW_LABELS: Record<WithdrawCode, string> = {
  price_changed: "A price changed",
  customer_cancelled: "The customer cancelled",
  entered_in_error: "It was made in error",
  other: "Another reason",
};
/** The flags a person must read before approving: plain words of OUR making (codes are the database's). */
export const FLAG_TEXT: Record<string, string> = {
  BELOW_MINIMUM_ORDER_QUANTITY: "A line is below its minimum order quantity.",
  CREDIT_LIMIT_EXCEEDED: "The balance is above the credit limit for a repeat customer.",
  TERMS_REQUESTED_BY_CUSTOMER: "The customer asked for payment terms of their own: the owner decides.",
  MIXED_GST_RATES_SHIPPING: "The lines carry different GST rates and freight is charged: check how the freight is taxed.",
  REPEAT_CUSTOMER_CLAIMED: "Marked as a repeat customer, which nobody has verified: the owner decides.",
  TYPED_PRICE_OUTSIDE_RANGE: "A price typed by a person is outside the usual range for its item type: check it before approving.",
};
export const MISSING_TEXT: Record<string, string> = {
  no_requirement: "This enquiry has no requirement yet.",
  requirement_not_confirmed: "Approve the requirement first.",
  no_price_list: "The workspace has no price list in force. An owner has to publish one before a quote can be made.",
  no_policy: "The workspace has no quote policy in force. An owner has to publish one before a quote can be made.",
  mapper_unavailable: "Product suggestions are not available right now. You can still pick products by hand.",
};

/** How a quote was priced. The API leaves the field out of a list-price quote, so a missing `pricing_kind` means "list". */
export const PRICING_KINDS = ["list", "manual"] as const;
export type PricingKind = (typeof PRICING_KINDS)[number];
export const PRICE_SOURCES = ["list", "typed_by_person"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export interface QuoteLine {
  line_no: number;
  requirement_line_no: number;
  /** null on a typed-price line: it names an item type, not a product. */
  product_id: string | null;
  sku: string;
  name: string;
  sale_unit: SaleUnit;
  qty: number;
  unit_price_applied_paise: number;
  price_break_min_qty: number | null;
  line_subtotal_paise: number;
  net_paise: number;
  tax_paise: number;
  gross_paise: number;
  tax_bps: number;
  /** Present only on a typed-price line (the API leaves both out of a list-price line). */
  price_source?: PriceSource;
  item_type_code?: string;
}
export interface UnquotedLine {
  line_no: number;
  summary: string[];
}
export interface Quote {
  id: string;
  quote_no: number;
  requirement_id: string;
  enquiry_id: string;
  lead_id: string;
  status: (typeof STATUSES)[number];
  outcome: Outcome;
  /** Present only on a typed-price quote ("manual"); a missing value means "list". */
  pricing_kind?: PricingKind;
  /** null on a typed-price quote: it has no price list. */
  price_list_version_id: string | null;
  policy_version_id: string;
  engine_version: string;
  canonical_hash: string;
  customer_kind: CustomerKind;
  /** null on a typed-price quote made without a delivery state (then the label below is null too). */
  delivery_state: string | null;
  gst_supply: "intra_state" | "inter_state" | null;
  as_of: string;
  valid_until: string;
  due_date: string;
  merchandise_net_paise: number;
  item_tax_paise: number;
  shipping_net_paise: number;
  shipping_tax_paise: number;
  total_paise: number;
  advance_paise: number;
  balance_paise: number;
  engine_flags: string[];
  review_flags: string[];
  needs_owner_approval: boolean;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_code: RejectCode | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  withdraw_code: WithdrawCode | null;
  lines: QuoteLine[];
  unquoted_lines: UnquotedLine[];
}
export interface QuoteSummary {
  id: string;
  quote_no: number;
  enquiry_id: string;
  status: (typeof STATUSES)[number];
  outcome: Outcome;
  pricing_kind?: PricingKind;
  customer_kind: CustomerKind;
  valid_until: string;
  total_paise: number;
  needs_owner_approval: boolean;
  created_at: string;
  /** the customer's company name and city (null when the lead has no company) */
  customer: string | null;
  city: string | null;
}

/** True for a quote whose prices a person typed. A missing `pricing_kind` is a list-price quote. */
export const isManual = (quote: { pricing_kind?: PricingKind }): boolean => quote.pricing_kind === "manual";
export interface PriceItem {
  product_id: string;
  sku: string;
  name: string;
  sale_unit: SaleUnit;
  unit_price_paise: number;
  minimum_order_quantity: number;
  tax_bps: number;
}
export interface Suggestion {
  status: "matched" | "ambiguous" | "unmatched" | "needs_human" | "needs_input";
  reason: string | null;
  candidates: PriceItem[];
  truncated: boolean;
}
export interface Picked {
  product_id: string;
  qty: number;
  sale_unit: SaleUnit;
  source: "manual" | "mapper_suggestion";
}
export interface SetupLine {
  line_no: number;
  summary: string[];
  quantity: number | null;
  basis: string | null;
  quotable: boolean;
  pick: Picked | null;
  suggestion: Suggestion | null;
}
export interface QuoteSetup {
  requirement_id: string | null;
  requirement_status: "draft" | "confirmed" | null;
  today: string;
  price_list_version_id: string | null;
  policy_version_id: string | null;
  seller_state: string | null;
  required_inputs: string[];
  mapper_version: string | null;
  missing: string[];
  lines: SetupLine[];
  price_list: PriceItem[];
  delivery_states: Record<string, string>;
}
export interface Decision {
  quote_id: string;
  status: (typeof STATUSES)[number];
  replayed: boolean;
}
export interface QuoteText {
  text: string;
  line_count: number;
  canonical_hash: string;
  renderer_version: string;
  sent_by_system: false;
}
export interface Approval extends Decision {
  approved_by: string | null;
  text: QuoteText | null;
  text_error: string | null;
}
export interface Pick {
  pick_id: string;
  line: number;
  product_id: string;
  qty: number;
  sale_unit: SaleUnit;
  source: "manual" | "mapper_suggestion";
  replayed: boolean;
}

// ----------------------------------------------------------------------------- money
/** Integer paise as rupees with Indian digit grouping (1,50,000.00); decimals always shown. Integers only: anything else is a contract error. */
export function formatRupees(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new ApiContractError("Unexpected amount in a quote response.");
  const whole = Math.floor(paise / 100);
  const part = paise % 100;
  const digits = String(whole);
  let grouped = digits;
  if (digits.length > 3) {
    let head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    const groups: string[] = [];
    while (head.length > 2) {
      groups.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) groups.unshift(head);
    grouped = [...groups, tail].join(",");
  }
  return `₹${grouped}.${String(part).padStart(2, "0")}`;
}

/** A rate in basis points as a percentage: 500 -> 5%, 1250 -> 12.5%. */
export function formatBps(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) throw new ApiContractError("Unexpected rate in a quote response.");
  const text = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${text}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-21" -> "21 Oct 2026". A date only (no clock, no zone): a quote's dates are calendar dates in India. Anything else is returned as it came. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// ----------------------------------------------------------------------------- parsing
type Rec = Record<string, unknown>;
function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a quote response.`);
}
function str(r: Rec, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : bad(key);
}
function strOrNull(r: Rec, key: string): string | null {
  const v = r[key];
  return v === null ? null : typeof v === "string" ? v : bad(key);
}
function int(r: Rec, key: string): number {
  const v = r[key];
  return typeof v === "number" && Number.isSafeInteger(v) ? v : bad(key);
}
function intOrNull(r: Rec, key: string): number | null {
  const v = r[key];
  return v === null ? null : typeof v === "number" && Number.isSafeInteger(v) ? v : bad(key);
}
function bool(r: Rec, key: string): boolean {
  const v = r[key];
  return typeof v === "boolean" ? v : bad(key);
}
function oneOf<T extends string>(r: Rec, key: string, allowed: readonly T[]): T {
  const v = r[key];
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(key);
}
function oneOfOrNull<T extends string>(r: Rec, key: string, allowed: readonly T[]): T | null {
  return r[key] === null ? null : oneOf(r, key, allowed);
}
function list(v: unknown, what: string): unknown[] {
  return Array.isArray(v) ? v : bad(what);
}
function strings(v: unknown, what: string): string[] {
  return list(v, what).map((s) => (typeof s === "string" ? s : bad(what)));
}

/** `pricing_kind` is optional on the wire: absent = list. Only a value the API really sends is kept, so a list-price quote parses to exactly what it always did. */
function kindOf(r: Rec): { pricing_kind?: PricingKind } {
  if (!("pricing_kind" in r)) return {};
  return { pricing_kind: oneOf(r, "pricing_kind", PRICING_KINDS) };
}

function parseLine(json: unknown): QuoteLine {
  if (!isRecord(json)) return bad("line");
  const typed: { price_source?: PriceSource; item_type_code?: string } = {};
  if ("price_source" in json) typed.price_source = oneOf(json, "price_source", PRICE_SOURCES);
  if ("item_type_code" in json) typed.item_type_code = str(json, "item_type_code");
  return {
    line_no: int(json, "line_no"),
    requirement_line_no: int(json, "requirement_line_no"),
    product_id: strOrNull(json, "product_id"),
    sku: str(json, "sku"),
    name: str(json, "name"),
    sale_unit: oneOf(json, "sale_unit", SALE_UNITS),
    qty: int(json, "qty"),
    unit_price_applied_paise: int(json, "unit_price_applied_paise"),
    price_break_min_qty: intOrNull(json, "price_break_min_qty"),
    line_subtotal_paise: int(json, "line_subtotal_paise"),
    net_paise: int(json, "net_paise"),
    tax_paise: int(json, "tax_paise"),
    gross_paise: int(json, "gross_paise"),
    tax_bps: int(json, "tax_bps"),
    ...typed,
  };
}

export function parseQuote(json: unknown): Quote {
  if (!isRecord(json)) return bad("quote");
  return {
    id: str(json, "id"),
    quote_no: int(json, "quote_no"),
    requirement_id: str(json, "requirement_id"),
    enquiry_id: str(json, "enquiry_id"),
    lead_id: str(json, "lead_id"),
    status: oneOf(json, "status", STATUSES),
    outcome: oneOf(json, "outcome", OUTCOMES),
    ...kindOf(json),
    price_list_version_id: strOrNull(json, "price_list_version_id"),
    policy_version_id: str(json, "policy_version_id"),
    engine_version: str(json, "engine_version"),
    canonical_hash: str(json, "canonical_hash"),
    customer_kind: oneOf(json, "customer_kind", CUSTOMER_KINDS),
    delivery_state: strOrNull(json, "delivery_state"),
    gst_supply: oneOfOrNull(json, "gst_supply", ["intra_state", "inter_state"] as const),
    as_of: str(json, "as_of"),
    valid_until: str(json, "valid_until"),
    due_date: str(json, "due_date"),
    merchandise_net_paise: int(json, "merchandise_net_paise"),
    item_tax_paise: int(json, "item_tax_paise"),
    shipping_net_paise: int(json, "shipping_net_paise"),
    shipping_tax_paise: int(json, "shipping_tax_paise"),
    total_paise: int(json, "total_paise"),
    advance_paise: int(json, "advance_paise"),
    balance_paise: int(json, "balance_paise"),
    engine_flags: strings(json.engine_flags, "engine_flags"),
    review_flags: strings(json.review_flags, "review_flags"),
    needs_owner_approval: bool(json, "needs_owner_approval"),
    created_by: strOrNull(json, "created_by"),
    created_at: str(json, "created_at"),
    approved_by: strOrNull(json, "approved_by"),
    approved_at: strOrNull(json, "approved_at"),
    rejected_by: strOrNull(json, "rejected_by"),
    rejected_at: strOrNull(json, "rejected_at"),
    reject_code: oneOfOrNull(json, "reject_code", REJECT_CODES),
    withdrawn_by: strOrNull(json, "withdrawn_by"),
    withdrawn_at: strOrNull(json, "withdrawn_at"),
    withdraw_code: oneOfOrNull(json, "withdraw_code", WITHDRAW_CODES),
    lines: list(json.lines, "lines").map(parseLine),
    unquoted_lines: list(json.unquoted_lines, "unquoted_lines").map((u) => {
      if (!isRecord(u)) return bad("unquoted line");
      return { line_no: int(u, "line_no"), summary: strings(u.summary, "summary") };
    }),
  };
}

export function parseQuoteSummary(json: unknown): QuoteSummary {
  if (!isRecord(json)) return bad("quote summary");
  return {
    id: str(json, "id"),
    quote_no: int(json, "quote_no"),
    enquiry_id: str(json, "enquiry_id"),
    status: oneOf(json, "status", STATUSES),
    outcome: oneOf(json, "outcome", OUTCOMES),
    ...kindOf(json),
    customer_kind: oneOf(json, "customer_kind", CUSTOMER_KINDS),
    valid_until: str(json, "valid_until"),
    total_paise: int(json, "total_paise"),
    needs_owner_approval: bool(json, "needs_owner_approval"),
    created_at: str(json, "created_at"),
    customer: strOrNull(json, "customer"),
    city: strOrNull(json, "city"),
  };
}

function parseItem(json: unknown): PriceItem {
  if (!isRecord(json)) return bad("price item");
  return {
    product_id: str(json, "product_id"),
    sku: str(json, "sku"),
    name: str(json, "name"),
    sale_unit: oneOf(json, "sale_unit", SALE_UNITS),
    unit_price_paise: int(json, "unit_price_paise"),
    minimum_order_quantity: int(json, "minimum_order_quantity"),
    tax_bps: int(json, "tax_bps"),
  };
}

const SUGGESTION_STATUSES = ["matched", "ambiguous", "unmatched", "needs_human", "needs_input"] as const;

export function parseSetup(json: unknown): QuoteSetup {
  if (!isRecord(json) || !isRecord(json.delivery_states)) return bad("setup");
  const states: Record<string, string> = {};
  for (const [code, name] of Object.entries(json.delivery_states)) {
    if (typeof name !== "string") return bad("delivery_states");
    states[code] = name;
  }
  return {
    requirement_id: strOrNull(json, "requirement_id"),
    requirement_status: oneOfOrNull(json, "requirement_status", ["draft", "confirmed"] as const),
    today: str(json, "today"),
    price_list_version_id: strOrNull(json, "price_list_version_id"),
    policy_version_id: strOrNull(json, "policy_version_id"),
    seller_state: strOrNull(json, "seller_state"),
    required_inputs: strings(json.required_inputs, "required_inputs"),
    mapper_version: strOrNull(json, "mapper_version"),
    missing: strings(json.missing, "missing"),
    lines: list(json.lines, "lines").map((l) => {
      if (!isRecord(l)) return bad("setup line");
      const pick = l.pick;
      const sug = l.suggestion;
      return {
        line_no: int(l, "line_no"),
        summary: strings(l.summary, "summary"),
        quantity: intOrNull(l, "quantity"),
        basis: strOrNull(l, "basis"),
        quotable: bool(l, "quotable"),
        pick:
          pick === null
            ? null
            : isRecord(pick)
              ? {
                  product_id: str(pick, "product_id"),
                  qty: int(pick, "qty"),
                  sale_unit: oneOf(pick, "sale_unit", SALE_UNITS),
                  source: oneOf(pick, "source", ["manual", "mapper_suggestion"] as const),
                }
              : bad("pick"),
        suggestion:
          sug === null
            ? null
            : isRecord(sug)
              ? {
                  status: oneOf(sug, "status", SUGGESTION_STATUSES),
                  reason: strOrNull(sug, "reason"),
                  candidates: list(sug.candidates, "candidates").map(parseItem),
                  truncated: bool(sug, "truncated"),
                }
              : bad("suggestion"),
      };
    }),
    price_list: list(json.price_list, "price_list").map(parseItem),
    delivery_states: states,
  };
}

function parseText(json: unknown): QuoteText {
  if (!isRecord(json) || json.sent_by_system !== false) return bad("quote text");
  return {
    text: str(json, "text"),
    line_count: int(json, "line_count"),
    canonical_hash: str(json, "canonical_hash"),
    renderer_version: str(json, "renderer_version"),
    sent_by_system: false,
  };
}
export const parseQuoteText = parseText;

export function parseDecision(json: unknown): Decision {
  if (!isRecord(json)) return bad("decision");
  return { quote_id: str(json, "quote_id"), status: oneOf(json, "status", STATUSES), replayed: bool(json, "replayed") };
}

export function parseApproval(json: unknown): Approval {
  if (!isRecord(json)) return bad("approval");
  return {
    ...parseDecision(json),
    approved_by: strOrNull(json, "approved_by"),
    text: json.text === null ? null : parseText(json.text),
    text_error: strOrNull(json, "text_error"),
  };
}

export function parsePick(json: unknown): Pick {
  if (!isRecord(json)) return bad("pick");
  return {
    pick_id: str(json, "pick_id"),
    line: int(json, "line"),
    product_id: str(json, "product_id"),
    qty: int(json, "qty"),
    sale_unit: oneOf(json, "sale_unit", SALE_UNITS),
    source: oneOf(json, "source", ["manual", "mapper_suggestion"] as const),
    replayed: bool(json, "replayed"),
  };
}

// ----------------------------------------------------------------------------- requests (ids are checked BEFORE they reach a path)
function checked(...ids: string[]): void {
  for (const id of ids) if (!isCanonicalUuid(id)) throw new ApiContractError("id");
}
const base = (tenantId: string) => `/v1/tenants/${tenantId}`;
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export async function fetchQuoteSetup(accessToken: string, tenantId: string, enquiryId: string): Promise<QuoteSetup> {
  checked(tenantId, enquiryId);
  return parseSetup(await apiRequest(`${base(tenantId)}/enquiries/${enquiryId}/quote-setup`, accessToken));
}

/** `GET /v1/tenants/{tenant}/quotes`: the workspace's newest quotes (Owner, Admin, Sales), each with the customer's company name and city. `limit` is 1 to 50 (default 20). */
export async function fetchQuotes(accessToken: string, tenantId: string, limit = 20): Promise<QuoteSummary[]> {
  checked(tenantId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ApiContractError("limit");
  return list(await apiRequest(`${base(tenantId)}/quotes?limit=${limit}`, accessToken), "quotes").map(parseQuoteSummary);
}

export async function fetchEnquiryQuotes(accessToken: string, tenantId: string, enquiryId: string): Promise<QuoteSummary[]> {
  checked(tenantId, enquiryId);
  return list(await apiRequest(`${base(tenantId)}/enquiries/${enquiryId}/quotes`, accessToken), "quotes").map(parseQuoteSummary);
}

export async function fetchQuote(accessToken: string, tenantId: string, quoteId: string): Promise<Quote> {
  checked(tenantId, quoteId);
  return parseQuote(await apiRequest(`${base(tenantId)}/quotes/${quoteId}`, accessToken));
}

export async function fetchQuoteText(accessToken: string, tenantId: string, quoteId: string): Promise<QuoteText> {
  checked(tenantId, quoteId);
  return parseText(await apiRequest(`${base(tenantId)}/quotes/${quoteId}/text`, accessToken));
}

export interface PickInput {
  line: number;
  productId: string;
  qty: number;
  saleUnit: SaleUnit;
  fromSuggestion: boolean;
}

export async function pickProduct(accessToken: string, tenantId: string, enquiryId: string, input: PickInput): Promise<Pick> {
  checked(tenantId, enquiryId, input.productId);
  return parsePick(
    await apiRequest(
      `${base(tenantId)}/enquiries/${enquiryId}/picks`,
      accessToken,
      post({ line: input.line, product_id: input.productId, qty: input.qty, sale_unit: input.saleUnit, from_suggestion: input.fromSuggestion }),
    ),
  );
}

export interface CreateQuoteInput {
  id: string;
  customerKind: CustomerKind;
  deliveryState: string;
}

export async function createQuote(accessToken: string, tenantId: string, enquiryId: string, input: CreateQuoteInput): Promise<Quote> {
  checked(tenantId, enquiryId, input.id);
  return parseQuote(
    await apiRequest(
      `${base(tenantId)}/enquiries/${enquiryId}/quotes`,
      accessToken,
      post({ id: input.id, customer_kind: input.customerKind, delivery_state: input.deliveryState }),
    ),
  );
}

export async function approveQuote(accessToken: string, tenantId: string, quoteId: string): Promise<Approval> {
  checked(tenantId, quoteId);
  return parseApproval(await apiRequest(`${base(tenantId)}/quotes/${quoteId}/approve`, accessToken, post()));
}

export async function rejectQuote(accessToken: string, tenantId: string, quoteId: string, code: RejectCode): Promise<Decision> {
  checked(tenantId, quoteId);
  return parseDecision(await apiRequest(`${base(tenantId)}/quotes/${quoteId}/reject`, accessToken, post({ code })));
}

export async function withdrawQuote(accessToken: string, tenantId: string, quoteId: string, code: WithdrawCode): Promise<Decision> {
  checked(tenantId, quoteId);
  return parseDecision(await apiRequest(`${base(tenantId)}/quotes/${quoteId}/withdraw`, accessToken, post({ code })));
}

export interface ManualLineInput {
  itemTypeCode: string;
  qty: number;
  /** Integer paise: the person's own price, typed in rupees and converted exactly by the form. */
  unitPricePaise: number;
}
export interface CreateManualQuoteInput {
  id: string;
  customerKind: CustomerKind;
  /** null / left out: the quote is made without a delivery state. */
  deliveryState: string | null;
  lines: ManualLineInput[];
}

/** A quote with typed prices (Owner or Admin). The body has EXACTLY the keys the API allows; the API and the database decide everything else. A retry with the same id replays. */
export async function createManualQuote(accessToken: string, tenantId: string, enquiryId: string, input: CreateManualQuoteInput): Promise<Quote> {
  checked(tenantId, enquiryId, input.id);
  if (input.lines.length < 1 || input.lines.length > 5) throw new ApiContractError("lines");
  const body: Record<string, unknown> = {
    id: input.id,
    customer_kind: input.customerKind,
    lines: input.lines.map((l) => ({ item_type_code: l.itemTypeCode, qty: l.qty, unit_price_paise: l.unitPricePaise })),
  };
  if (input.deliveryState !== null) body.delivery_state = input.deliveryState;
  return parseQuote(await apiRequest(`${base(tenantId)}/enquiries/${enquiryId}/manual-quotes`, accessToken, post(body)));
}
