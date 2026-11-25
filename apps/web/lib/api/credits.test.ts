import { describe, expect, it } from "vitest";

import { failOf, parseBalanceAndDebt, parseInvoice, parseOptions, parseOrder, parseStatement, parseTopups } from "./credits";
import { ApiRequestError } from "./client";

describe("credits: C1's answers, checked", () => {
  it("options and order", () => {
    const o = parseOptions({ gst_percent: 18, presets: [{ added_paise: 50000, gst_paise: 9000, total_paise: 59000, added_text: "₹500", gst_text: "₹90", total_text: "₹590" }], custom_min_rupees: 100, custom_max_rupees: 100000, mode: "fake", checkout_ready: true });
    expect(o).toMatchObject({ gstPercent: 18, mode: "fake", customMax: 100000 });
    expect(parseOrder({ order_id: "o1", key_id: null, mode: "fake", amount_paise: 59000, added_text: "₹500", gst_text: "₹90", total_text: "₹590", name: "N", description: "D" })).toMatchObject({ keyId: null, amountPaise: 59000 });
  });
  it("top-ups and the statement", () => {
    expect(parseTopups({ items: [{ order_id: "o", state: "paid", added_text: "₹500", total_text: "₹590", created_at: "2026-11-24T10:00:00Z", paid_at: null, invoice_number: "S19-2627-000001", refunded: false }] })[0]).toMatchObject({ state: "paid", invoiceNumber: "S19-2627-000001" });
    expect(() => parseTopups({ items: [{ order_id: "o", state: "weird" }] })).not.toThrow(); // a row it cannot read is left out
    const s = parseStatement({ items: [{ at: "2026-11-24T10:00:00Z", kind: "credit", label: "Top-up", amount_paise: 100, amount_text: "₹1", balance_after_text: "₹1" }], has_more: false, balance_text: "₹1" });
    expect(s.items[0]).toMatchObject({ kind: "credit", amountPaise: 100 });
  });
  it("an invoice without the seller's details is a draft; the GST split is drawn as sent", () => {
    const inv = parseInvoice({ number: "S19-2627-000001", issued_at: "2026-11-24T10:00:00Z", subtotal_text: "₹1,000", gst_text: "₹180", total_text: "₹1,180", tax_split: "cgst_sgst", cgst_text: "₹90", sgst_text: "₹90", seller_details_missing: true });
    expect(inv.draft).toBe(true);
    expect(inv.lines).toEqual([{ label: "CGST 9%", text: "₹90" }, { label: "SGST 9%", text: "₹90" }]);
  });
  it("what is owed is read only from owed_paise (C1 sends no debt otherwise, and the balance never goes below 0)", () => {
    expect(parseBalanceAndDebt({ balance_paise: 0, owed_paise: 3500 }).debtPaise).toBe(3500);
    expect(parseBalanceAndDebt({ balance_paise: 0, debt_paise: 3500, shortfall_paise: 3500 }).debtPaise).toBeNull();
    expect(parseBalanceAndDebt({ balance_paise: -2000 })).toEqual({ balance: null, debtPaise: null });
    expect(parseBalanceAndDebt({ balance_paise: 5000, owed_paise: 0 }).debtPaise).toBeNull();
    expect(parseBalanceAndDebt("nope")).toEqual({ balance: null, debtPaise: null });
  });
  it("refusals are closed words", () => {
    expect(failOf(new ApiRequestError(422, "topup_amount_invalid", "x"))).toEqual({ ok: false, error: "amount" });
    expect(failOf(new ApiRequestError(403, "mfa_required", "x"))).toEqual({ ok: false, error: "mfa" });
    expect(failOf(new ApiRequestError(500, "x", "x"))).toEqual({ ok: false, error: "unavailable" });
  });
});
