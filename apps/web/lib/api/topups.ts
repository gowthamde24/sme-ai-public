import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, nstr, oneOf, optStr, rec, str, uuid, word } from "./shape";
import type { Balance, Invoice, Kind, Lot, Meter, Pack, Period, Purchase, TopupSettings, TopupsView, UpgradePreview, UsageView } from "@/lib/topups/types";
import { KINDS } from "@/lib/topups/types";

/**
 * C1's top-up API (night 4, job E2; ~/Desktop/stack19-jobs/contract-topups.md, sections 1 to 7), for the signed-in person's own token. SERVER ONLY. Every answer is checked by the parsers below, which follow the contract text
 * exactly (the generated types of the contract were not on a branch when this was written: when `packages/contracts/billing.ts` has them, compare the field names once). A body that is not the contract is an ApiContractError, never
 * drawn. ONE place to change: the `parse*` functions and the paths at the bottom. Money is integer paise; units can be fractions (a call minute is counted in tenths), so counts use `num`.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, what: string, min = 0, max = 1e9): number => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : bad(what));
const optNum = (v: unknown, what: string): number | null => (v === null || v === undefined ? null : num(v, what));
const day = (v: unknown, what: string): string => (typeof v === "string" && DAY.test(v) ? v : bad(what));
const optDay = (v: unknown, what: string): string | null => (v === null || v === undefined ? null : day(v, what));
const stamp = (v: unknown, what: string): string => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : bad(what));
const kind = (v: unknown, what: string): Kind => oneOf(v, KINDS, what);

function parseOverage(v: unknown): Meter["overage"] {
  if (v === null || v === undefined) return null;
  const o = rec(v, "overage");
  return { enabled: bool(o.enabled, "overage.enabled"), units: num(o.units, "overage.units"), spentPaise: int(o.spent_paise, "overage.spent_paise"), capPaise: int(o.cap_paise, "overage.cap_paise"), ratePaisePerUnit: int(o.rate_paise_per_unit, "overage.rate_paise_per_unit") };
}

/** The generated type (origin/api/ds-topups, packages/contracts/billing.ts) marks the top-up fields of a meter OPTIONAL (an older route may leave them out): a missing one reads as "nothing" (no top-up, not blocked beyond its state, nothing queued). A field that is there must be right. */
export function parseMeter(json: unknown): Meter {
  const m = rec(json, "meter");
  const allowance = optNum(m.allowance, "meter.allowance");
  const state = oneOf(m.state, ["ok", "notice", "stopped"] as const, "meter.state");
  const projected = optDay(m.projected_run_out_on, "meter.projected_run_out_on");
  return {
    kind: kind(m.kind, "meter.kind"),
    used: num(m.used, "meter.used"),
    allowance,
    remaining: optNum(m.remaining, "meter.remaining"),
    percent: optNum(m.percent, "meter.percent"),
    state,
    included: bool(m.included, "meter.included"),
    planAllowance: m.plan_allowance === undefined ? allowance : optNum(m.plan_allowance, "meter.plan_allowance"),
    topupBalance: m.topup_balance === undefined ? num(m.topup ?? 0, "meter.topup") : num(m.topup_balance, "meter.topup_balance"),
    nextTopupExpiry: optDay(m.next_topup_expiry, "meter.next_topup_expiry"),
    projectedRunOutOn: projected,
    runsOutBeforePeriodEnd: m.runs_out_before_period_end === undefined ? projected !== null : bool(m.runs_out_before_period_end, "meter.runs_out_before_period_end"),
    blocked: m.blocked === undefined ? state === "stopped" : bool(m.blocked, "meter.blocked"),
    overage: parseOverage(m.overage),
    queued: m.queued === undefined ? 0 : int(m.queued, "meter.queued"),
  };
}

function parsePeriod(json: unknown): Period {
  const p = rec(json, "period");
  return { start: day(p.start, "period.start"), end: day(p.end, "period.end"), daysLeft: int(p.days_left, "period.days_left", 0, 400) };
}

/** `GET /billing/usage` (UsageViewOut + `queued_calls`). The same meters are in `BillingOut.usage`, so a `BillingOut` answer reads through the same function. */
export function parseUsageView(json: unknown): UsageView {
  const j = rec(json, "usage view");
  const usage = rec(j.usage, "usage");
  const minutes = parseMeter(usage.call_minutes);
  const messages = parseMeter(usage.whatsapp_messages);
  if (minutes.kind !== "call_minutes" || messages.kind !== "whatsapp_messages") bad("usage kinds");
  return { period: parsePeriod(j.period), minutes, messages, queuedCalls: j.queued_calls === undefined ? minutes.queued : int(j.queued_calls, "queued_calls") };
}

export function parsePack(json: unknown): Pack {
  const p = rec(json, "pack");
  return {
    code: word(p.code, "pack.code"),
    kind: kind(p.kind, "pack.kind"),
    units: int(p.units, "pack.units", 1),
    pricePaise: int(p.price_paise, "pack.price_paise"),
    gstRateBp: int(p.gst_rate_bp, "pack.gst_rate_bp", 0, 10_000),
    gstPaise: int(p.gst_paise, "pack.gst_paise"),
    totalPaise: int(p.total_paise, "pack.total_paise"),
    isPlaceholder: bool(p.price_is_placeholder, "pack.price_is_placeholder"),
  };
}

function parseLot(json: unknown): Lot {
  const l = rec(json, "lot");
  return { purchaseId: uuid(l.purchase_id, "lot.purchase_id"), unitsLeft: num(l.units_left, "lot.units_left"), purchasedAt: stamp(l.purchased_at, "lot.purchased_at"), expiresAt: stamp(l.expires_at, "lot.expires_at") };
}
function parseBalance(json: unknown): Balance {
  const b = rec(json, "balance");
  const one = (v: unknown) => {
    const r = rec(v, "balance kind");
    return { units: num(r.units, "balance.units"), lots: list(r.lots, "balance.lots", 200).map(parseLot) };
  };
  return { call_minutes: one(b.call_minutes), whatsapp_messages: one(b.whatsapp_messages) };
}

export function parseSettings(json: unknown): TopupSettings {
  const s = rec(json, "settings");
  const pack = (v: unknown, what: string) => (v === null || v === undefined ? null : word(v, what));
  return {
    autoMinutesPack: pack(s.auto_minutes_pack, "auto_minutes_pack"),
    autoMessagesPack: pack(s.auto_messages_pack, "auto_messages_pack"),
    autoMonthlyCapPaise: int(s.auto_monthly_cap_paise, "auto_monthly_cap_paise"),
    overageMinutes: bool(s.overage_minutes, "overage_minutes"),
    overageMessages: bool(s.overage_messages, "overage_messages"),
    overageMonthlyCapPaise: int(s.overage_monthly_cap_paise, "overage_monthly_cap_paise"),
    overageRatePaisePerMinute: int(s.overage_rate_paise_per_minute, "overage_rate_paise_per_minute"),
    overageRatePaisePerMessage: int(s.overage_rate_paise_per_message, "overage_rate_paise_per_message"),
    autoSpentPaise: int(s.auto_spent_paise, "auto_spent_paise"),
    overageSpentPaise: int(s.overage_spent_paise, "overage_spent_paise"),
  };
}

export function parsePurchase(json: unknown): Purchase {
  const p = rec(json, "purchase");
  return {
    id: uuid(p.id, "purchase.id"),
    packCode: word(p.pack_code, "purchase.pack_code"),
    kind: kind(p.kind, "purchase.kind"),
    units: int(p.units, "purchase.units", 1),
    source: oneOf(p.source, ["manual", "auto", "operator"] as const, "purchase.source"),
    pricePaise: int(p.price_paise, "purchase.price_paise"),
    totalPaise: int(p.total_paise, "purchase.total_paise"),
    purchasedAt: stamp(p.purchased_at, "purchase.purchased_at"),
    expiresAt: stamp(p.expires_at, "purchase.expires_at"),
    unitsLeft: num(p.units_left, "purchase.units_left"),
    invoiceId: p.invoice_id === null || p.invoice_id === undefined ? null : uuid(p.invoice_id, "purchase.invoice_id"),
  };
}

export function parseInvoice(json: unknown): Invoice {
  const i = rec(json, "invoice");
  const seller = rec(i.seller, "invoice.seller");
  const buyer = rec(i.buyer, "invoice.buyer");
  return {
    id: uuid(i.id, "invoice.id"),
    number: nstr(i.number, "invoice.number", 40),
    kind: oneOf(i.kind, ["topup", "upgrade", "overage"] as const, "invoice.kind"),
    description: str(i.description, "invoice.description", 300),
    issuedAt: stamp(i.issued_at, "invoice.issued_at"),
    taxablePaise: int(i.taxable_paise, "invoice.taxable_paise"),
    gstRateBp: int(i.gst_rate_bp, "invoice.gst_rate_bp", 0, 10_000),
    cgstPaise: int(i.cgst_paise, "invoice.cgst_paise"),
    sgstPaise: int(i.sgst_paise, "invoice.sgst_paise"),
    igstPaise: int(i.igst_paise, "invoice.igst_paise"),
    totalPaise: int(i.total_paise, "invoice.total_paise"),
    sellerName: str(seller.name, "invoice.seller.name", 200),
    sellerStateCode: optStr(seller.state_code, "invoice.seller.state_code", 4),
    sellerGstin: optStr(seller.gstin, "invoice.seller.gstin", 20),
    buyerGstin: optStr(buyer.gstin, "invoice.buyer.gstin", 20),
    buyerStateCode: optStr(buyer.state_code, "invoice.buyer.state_code", 4),
    fake: bool(i.fake, "invoice.fake"),
    paymentStatus: word(i.payment_status, "invoice.payment_status"),
  };
}

/** `GET /billing/topups` (TopupsOut) joined with the usage read, in the shape the Plan part draws. */
export function parseTopups(json: unknown, usage: UsageView): TopupsView {
  const j = rec(json, "topups");
  return {
    mode: "on",
    planId: null,
    usage,
    packs: list(j.packs, "packs", 50).map(parsePack),
    balance: parseBalance(j.balance),
    settings: parseSettings(j.settings),
    history: list(j.history, "history", 100).map(parsePurchase),
    invoices: [],
  };
}
export function parseInvoices(json: unknown): Invoice[] {
  const j = rec(json, "invoices");
  return list(j.items, "invoices.items", 200).map(parseInvoice);
}

export function parseUpgradePreview(json: unknown): UpgradePreview {
  const p = rec(json, "upgrade preview");
  const a = rec(p.new_allowances, "new_allowances");
  const paise = (v: unknown, what: string) => (v === null || v === undefined ? null : int(v, what, -1_000_000_000));
  if (p.effective !== "now") bad("effective");
  return {
    fromPlanId: p.from_plan_id === null || p.from_plan_id === undefined ? null : word(p.from_plan_id, "from_plan_id"),
    toPlanId: word(p.to_plan_id, "to_plan_id"),
    priceSet: bool(p.price_set, "price_set"),
    daysInPeriod: int(p.days_in_period, "days_in_period", 1, 400),
    daysLeft: int(p.days_left, "days_left", 0, 400),
    proratedPaise: paise(p.prorated_paise, "prorated_paise"),
    gstPaise: paise(p.gst_paise, "gst_paise"),
    totalPaise: paise(p.total_paise, "total_paise"),
    newAllowances: { callMinutes: optNum(a.call_minutes, "call_minutes"), messages: optNum(a.whatsapp_messages, "whatsapp_messages") },
    effective: "now",
  };
}

// ---- the calls (the paths of contract-topups.md; the person's own token) ----
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return `/v1/tenants/${tenantId}/billing`;
};
export const getUsageView = async (token: string, tenantId: string): Promise<UsageView> => parseUsageView(await apiRequest(`${base(tenantId)}/usage`, token));
export const getTopups = async (token: string, tenantId: string, usage: UsageView): Promise<TopupsView> => parseTopups(await apiRequest(`${base(tenantId)}/topups`, token), usage);
export const getInvoices = async (token: string, tenantId: string): Promise<Invoice[]> => parseInvoices(await apiRequest(`${base(tenantId)}/invoices`, token));
export const getUpgradePreview = async (token: string, tenantId: string, planId: string): Promise<UpgradePreview> =>
  parseUpgradePreview(await apiRequest(`${base(tenantId)}/upgrade-preview?plan_id=${encodeURIComponent(planId)}`, token));
/** The purchase id is chosen by the client: the same id with the same pack answers again with the same body (nothing is charged twice). */
export async function postTopup(token: string, tenantId: string, purchaseId: string, packCode: string, checkoutRef: string): Promise<void> {
  const out = rec(await apiRequest(`${base(tenantId)}/topups`, token, { method: "POST", body: JSON.stringify({ purchase_id: purchaseId, pack_code: packCode, checkout_ref: checkoutRef }) }), "topup answer");
  parsePurchase(out.purchase);
  parseInvoice(out.invoice);
}
export async function putTopupSettings(token: string, tenantId: string, s: { autoMinutesPack: string | null; autoMessagesPack: string | null; autoMonthlyCapPaise: number; overageMinutes: boolean; overageMessages: boolean; overageMonthlyCapPaise: number }): Promise<TopupSettings> {
  const body = { auto_minutes_pack: s.autoMinutesPack, auto_messages_pack: s.autoMessagesPack, auto_monthly_cap_paise: s.autoMonthlyCapPaise, overage_minutes: s.overageMinutes, overage_messages: s.overageMessages, overage_monthly_cap_paise: s.overageMonthlyCapPaise };
  return parseSettings(await apiRequest(`${base(tenantId)}/topups/settings`, token, { method: "PUT", body: JSON.stringify(body) }));
}
export async function postUpgrade(token: string, tenantId: string, planId: string, checkoutRef: string): Promise<void> {
  const out = rec(await apiRequest(`${base(tenantId)}/upgrade`, token, { method: "POST", body: JSON.stringify({ plan_id: planId, checkout_ref: checkoutRef }) }), "upgrade answer");
  if (out.invoice !== null && out.invoice !== undefined) parseInvoice(out.invoice);
}
