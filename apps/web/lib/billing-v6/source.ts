import { ApiAuthError, ApiRequestError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { balanceScreens } from "@/lib/screens/flag";

import { parseBillingBalance, type BillingBalance } from "./balance";
import { mockInvoices, type Invoice } from "./invoices";
import { FREE_START_PAISE, TOPUP_CHOICES, keep, paiseOf, readState } from "./mock-state";
import { MOCK_PRICING, parsePricing, type Pricing } from "./pricing";
import { formatRupeesShort } from "@/lib/money";

/**
 * Where the Billing page gets and changes things. `1` = C1's routes (`GET /billing/balance`, `GET /v1/pricing`, `POST /billing/free-start`); the top-up and the invoices list come with Razorpay TEST, so with `1` they say "not available yet". `mock` = a TEST state in one cookie
 * of the browser (nothing is charged). Off = the page says billing is not available. A failed read is null. SERVER ONLY.
 */
export async function readBillingBalance(token: string, tenantId: string): Promise<BillingBalance | null> {
  const mode = balanceScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return null;
  if (mode === "mock") {
    const s = await readState();
    const paise = paiseOf(s);
    return { paise, text: formatRupeesShort(paise), minutesEstimate: Math.floor(paise / 500), planId: "sales_assistant", planName: "Sales assistant", low: false, topupAvailable: true, freeStartGranted: s.freeStart, freeStartLeftText: s.freeStart ? formatRupeesShort(FREE_START_PAISE) : null, includedMinutes: 500, includedMinutesLeft: 342, subscription: { interval: "monthly", status: "active", periodEnd: "2026-12-13T05:00:00Z", cancelAtPeriodEnd: false } };
  }
  try {
    return parseBillingBalance(await apiRequest(`/v1/tenants/${tenantId}/billing/balance`, token));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

export async function readPricing(token: string): Promise<Pricing | null> {
  const mode = balanceScreens();
  if (mode === "off") return null;
  if (mode === "mock") return MOCK_PRICING;
  try {
    return parsePricing(await apiRequest("/v1/pricing", token));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** The invoices: TEST data in `mock`, an empty list with `1` (C1's list comes with Razorpay TEST), null when billing is off. */
export async function readInvoices(): Promise<{ items: Invoice[]; test: boolean } | null> {
  const mode = balanceScreens();
  if (mode === "off") return null;
  if (mode === "mock") return { items: mockInvoices(await readState()), test: true };
  return { items: [], test: false };
}

export type Moved = { ok: true } | { ok: false; error: "not_available" | "invalid" | "forbidden" | "down" };

/** The free ₹50 (Owner, once). */
export async function claimFreeStart(token: string, tenantId: string): Promise<Moved> {
  const mode = balanceScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return { ok: false, error: "not_available" };
  if (mode === "mock") {
    const s = await readState();
    if (s.freeStart) return { ok: true };
    return (await keep({ ...s, freeStart: true })) ? { ok: true } : { ok: false, error: "invalid" };
  }
  try {
    await apiRequest(`/v1/tenants/${tenantId}/billing/free-start`, token, { method: "POST", body: JSON.stringify({}) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError && error.status === 403) return { ok: false, error: "forbidden" };
    if (error instanceof ApiRequestError && error.status === 404) return { ok: false, error: "not_available" };
    return { ok: false, error: "down" };
  }
}

/** A TEST top-up (only in `mock`): one of the four amounts, recorded in this browser. The real top-up is Razorpay's (C1, P3). */
export async function testTopup(paise: unknown, now: Date, id: string): Promise<Moved> {
  if (balanceScreens() !== "mock") return { ok: false, error: "not_available" };
  if (!(TOPUP_CHOICES as readonly unknown[]).includes(paise)) return { ok: false, error: "invalid" };
  const s = await readState();
  if (s.topups.length >= 6) return { ok: false, error: "invalid" };
  return (await keep({ ...s, topups: [{ id, at: now.toISOString(), paise: paise as number }, ...s.topups] })) ? { ok: true } : { ok: false, error: "invalid" };
}
