import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseBillingBalance, type BillingBalance } from "../billing-v6/balance";
import { bool, int, optStr, readRows, rec, str } from "./shape";

/**
 * Credits top-up through Razorpay (C1's docs/contracts/credits-topup.md, 24 Nov 2026; API flag PRICING_V2, 404 while off). SERVER ONLY, with the person's own token. Money is in whole paise; the texts of the API ("₹1,000") are shown as sent (they are made from the
 * paise by the server). Every refusal is a closed word drawn by the screen (`cr.err.*`).
 *   GET  /credits/topup-options    GET /credits/topups    GET /credits/statement    GET /gst-invoices/{number}    GET /balance (low)
 *   POST /credits/topups {amount_rupees}   POST /credits/topups/{order}/confirm {payment_id, signature}   POST /credits/topups/{order}/failed {reason}
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return `/v1/tenants/${tenantId}/billing`;
};
const text = (v: unknown, what: string): string => str(v, what, 60);

export type Preset = { addedPaise: number; gstPaise: number; totalPaise: number; addedText: string; gstText: string; totalText: string };
export type TopupOptions = { gstPercent: number; presets: Preset[]; customMin: number; customMax: number; mode: "test" | "fake" | "live"; checkoutReady: boolean };
export function parseOptions(json: unknown): TopupOptions {
  const x = rec(json, "options");
  const mode = x.mode === "live" || x.mode === "fake" ? x.mode : "test";
  return {
    gstPercent: int(x.gst_percent, "gst_percent", 0, 50),
    presets: readRows(x.presets, "presets", (r) => {
      const p = rec(r, "preset");
      return { addedPaise: int(p.added_paise, "added", 100, 10_000_000_00), gstPaise: int(p.gst_paise, "gst", 0, 10_000_000_00), totalPaise: int(p.total_paise, "total", 100, 10_000_000_00), addedText: text(p.added_text, "added_text"), gstText: text(p.gst_text, "gst_text"), totalText: text(p.total_text, "total_text") };
    }, 8),
    customMin: int(x.custom_min_rupees, "custom_min", 1, 1_000_000),
    customMax: int(x.custom_max_rupees, "custom_max", 1, 10_000_000),
    mode,
    checkoutReady: bool(x.checkout_ready, "checkout_ready"),
  };
}
export type Order = { mode: "test" | "fake" | "live"; orderId: string; keyId: string | null; amountPaise: number; addedText: string; gstText: string; totalText: string; name: string; description: string };
export function parseOrder(json: unknown): Order {
  const x = rec(json, "order");
  return { mode: x.mode === "live" || x.mode === "fake" ? x.mode : "test", orderId: str(x.order_id, "order_id", 80), keyId: typeof x.key_id === "string" && x.key_id.length <= 80 ? x.key_id : null, amountPaise: int(x.amount_paise, "amount_paise", 100, 10_000_000_00), addedText: text(x.added_text, "added_text"), gstText: text(x.gst_text, "gst_text"), totalText: text(x.total_text, "total_text"), name: str(x.name, "name", 80), description: str(x.description, "description", 120) };
}
export type Topup = { orderId: string; state: "pending" | "paid" | "failed" | "abandoned"; addedText: string; totalText: string; failureText: string | null; createdAt: string; paidAt: string | null; invoiceNumber: string | null; refunded: boolean };
const STATES = ["pending", "paid", "failed", "abandoned"] as const;
export function parseTopups(json: unknown): Topup[] {
  return readRows(rec(json, "topups").items, "items", (r) => {
    const x = rec(r, "topup");
    const state = (STATES as readonly string[]).includes(x.state as string) ? (x.state as Topup["state"]) : null;
    if (!state) throw new ApiContractError("state");
    return { orderId: str(x.order_id, "order_id", 80), state, addedText: text(x.added_text, "added_text"), totalText: text(x.total_text, "total_text"), failureText: optStr(x.failure_text, "failure_text", 200), createdAt: str(x.created_at, "created_at", 40), paidAt: optStr(x.paid_at, "paid_at", 40), invoiceNumber: optStr(x.invoice_number, "invoice_number", 20), refunded: x.refunded === true };
  }, 50);
}
export type StatementItem = { at: string; kind: "credit" | "usage" | "refund" | "expiry"; label: string; amountPaise: number; amountText: string; balanceAfterText: string; invoiceNumber: string | null };
export type Statement = { items: StatementItem[]; hasMore: boolean; nextBefore: string | null; balanceText: string };
const KINDS = ["credit", "usage", "refund", "expiry"] as const;
export function parseStatement(json: unknown): Statement {
  const x = rec(json, "statement");
  return {
    items: readRows(x.items, "items", (r) => {
      const i = rec(r, "item");
      const kind = (KINDS as readonly string[]).includes(i.kind as string) ? (i.kind as StatementItem["kind"]) : "credit";
      return { at: str(i.at, "at", 40), kind, label: str(i.label, "label", 160), amountPaise: int(i.amount_paise, "amount_paise", -10_000_000_00, 10_000_000_00), amountText: text(i.amount_text, "amount_text"), balanceAfterText: text(i.balance_after_text, "balance_after_text"), invoiceNumber: optStr(i.invoice_number, "invoice_number", 20) };
    }, 100),
    hasMore: x.has_more === true,
    nextBefore: optStr(x.next_before, "next_before", 80),
    balanceText: typeof x.balance_text === "string" ? x.balance_text.slice(0, 60) : "",
  };
}
export type Invoice = { number: string; kind: string; issuedAt: string; description: string; subtotalText: string; gstText: string; totalText: string; gstPercent: number | null; split: "cgst_sgst" | "igst" | null; buyerName: string | null; buyerGstin: string | null; sellerName: string | null; sellerGstin: string | null; draft: boolean; lines: { label: string; text: string }[] };
export function parseInvoice(json: unknown): Invoice {
  const x = rec(json, "invoice");
  const t = (k: string): string => (typeof x[k] === "string" ? (x[k] as string).slice(0, 80) : "");
  const split = x.tax_split === "cgst_sgst" || x.tax_split === "igst" ? x.tax_split : null;
  const lines: { label: string; text: string }[] = [];
  if (split === "cgst_sgst") lines.push({ label: "CGST 9%", text: t("cgst_text") }, { label: "SGST 9%", text: t("sgst_text") });
  else if (split === "igst") lines.push({ label: "IGST 18%", text: t("igst_text") });
  return { number: str(x.number, "number", 20), kind: t("kind"), issuedAt: str(x.issued_at, "issued_at", 40), description: t("description"), subtotalText: t("subtotal_text"), gstText: t("gst_text"), totalText: t("total_text"), gstPercent: typeof x.gst_percent === "number" ? x.gst_percent : null, split, buyerName: t("buyer_name") || null, buyerGstin: t("buyer_gstin") || null, sellerName: t("seller_name") || null, sellerGstin: t("seller_gstin") || null, draft: x.seller_details_missing === true, lines };
}

export const REASONS = ["topup_amount_invalid", "forbidden", "mfa_required", "unavailable"] as const;
export type CreditsFail = { ok: false; error: "amount" | "forbidden" | "mfa" | "unavailable" };
export function failOf(error: unknown): CreditsFail {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const w = error.reason ?? error.code;
    if (w === "topup_amount_invalid" || error.status === 422) return { ok: false, error: "amount" };
    if (w === "mfa_required") return { ok: false, error: "mfa" };
    if (error.status === 403) return { ok: false, error: "forbidden" };
  }
  return { ok: false, error: "unavailable" };
}

export const getOptions = async (token: string, t: string): Promise<TopupOptions> => parseOptions(await apiRequest(`${base(t)}/credits/topup-options`, token));
export const createOrder = async (token: string, t: string, amountRupees: number): Promise<Order> => parseOrder(await apiRequest(`${base(t)}/credits/topups`, token, { method: "POST", body: JSON.stringify({ amount_rupees: amountRupees }) }));
export async function confirmOrder(token: string, t: string, orderId: string, paymentId: string, signature: string): Promise<{ addedText: string }> {
  const x = rec(await apiRequest(`${base(t)}/credits/topups/${encodeURIComponent(orderId)}/confirm`, token, { method: "POST", body: JSON.stringify({ payment_id: paymentId, signature }) }), "confirm");
  return { addedText: typeof x.added_text === "string" ? x.added_text.slice(0, 60) : "" };
}
export async function failOrder(token: string, t: string, orderId: string, reason: "failed" | "dismissed" | "cancelled"): Promise<void> {
  await apiRequest(`${base(t)}/credits/topups/${encodeURIComponent(orderId)}/failed`, token, { method: "POST", body: JSON.stringify({ reason }) });
}
export const listTopups = async (token: string, t: string): Promise<Topup[]> => parseTopups(await apiRequest(`${base(t)}/credits/topups?limit=20`, token));
export async function getStatement(token: string, t: string, before: string | null): Promise<Statement> {
  const q = new URLSearchParams({ limit: "20" });
  if (before) q.set("before", before);
  return parseStatement(await apiRequest(`${base(t)}/credits/statement?${q.toString()}`, token));
}
export async function getInvoice(token: string, t: string, number: string): Promise<Invoice> {
  if (!/^[A-Z0-9-]{5,20}$/.test(number)) throw new ApiContractError("invoice number");
  return parseInvoice(await apiRequest(`${base(t)}/gst-invoices/${number}`, token));
}
export const getBalance = async (token: string, t: string): Promise<BillingBalance | null> => parseBillingBalance(await apiRequest(`${base(t)}/balance`, token));
