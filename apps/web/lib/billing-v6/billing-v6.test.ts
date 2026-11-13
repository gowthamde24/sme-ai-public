import { describe, expect, it } from "vitest";

import { parseBillingBalance } from "./balance";
import { gstInside, mockInvoices, withGst } from "./invoices";
import { BASE_PAISE, FREE_START_PAISE, NOTHING, TOPUP_CHOICES, paiseOf, parseState } from "./mock-state";
import { MOCK_PRICING, parsePricing } from "./pricing";

const WIRE = { balance_paise: 155_000, balance_text: "₹1,550", minutes_estimate: 310, summary_text: "x", plan_id: "sales_assistant", plan_name: "Sales assistant", low: false, topup_available: true, free_start_granted: true, free_start_left_paise: 4000, free_start_left_text: "₹40", included_minutes: 500, included_minutes_left: 342, subscription: { interval: "monthly", status: "active", period_end: "2026-12-13T05:00:00Z", cancel_at_period_end: false, price_locked_until: null } };

describe("the balance of the Billing page", () => {
  it("reads C1's answer and makes the rupee text itself", () => {
    expect(parseBillingBalance({ ...WIRE, balance_text: "credits 1550" })).toMatchObject({ paise: 155_000, text: "₹1,550", minutesEstimate: 310, planId: "sales_assistant", planName: "Sales assistant", topupAvailable: true, freeStartGranted: true, freeStartLeftText: "₹40", includedMinutes: 500, includedMinutesLeft: 342, subscription: { interval: "monthly", status: "active", cancelAtPeriodEnd: false } });
  });
  it("copes with no plan, no subscription, nothing of the free start left", () => {
    const b = parseBillingBalance({ balance_paise: 0 });
    expect(b).toMatchObject({ paise: 0, text: "₹0", planName: null, subscription: null, freeStartGranted: false, freeStartLeftText: null, low: false });
    expect(parseBillingBalance({ ...WIRE, free_start_left_paise: 0 })?.freeStartLeftText).toBeNull();
  });
  it("refuses an odd answer", () => {
    expect(parseBillingBalance(null)).toBeNull();
    expect(parseBillingBalance([])).toBeNull();
    expect(parseBillingBalance({ balance_paise: -1 })).toBeNull();
    expect(parseBillingBalance({ balance_paise: 1.5 })).toBeNull();
    expect(parseBillingBalance({ balance_paise: 10 ** 12 })).toBeNull();
  });
});

describe("the plans", () => {
  it("reads the catalogue and keeps the plan ids as data", () => {
    const p = parsePricing({ gst_text: "+18% GST on invoices", free_start_text: "₹50 free to start, no card", plans: [{ id: "payg", name: "Pay as you go", monthly_text: "₹499 a month", lead_finder: false }, { id: "x_new", name: "New one", monthly_text: "₹1 a month", lead_finder: true, included_minutes: 3 }] });
    expect(p?.plans.map((x) => x.id)).toEqual(["payg", "x_new"]);
    expect(p?.plans[1]).toMatchObject({ leadFinder: true, includedMinutes: 3 });
    expect(p?.gstText).toBe("+18% GST on invoices");
  });
  it("refuses a catalogue without plans or with a plan without a price", () => {
    expect(parsePricing({ plans: [] })).toBeNull();
    expect(parsePricing({ plans: [{ id: "a", name: "A" }] })).toBeNull();
    expect(parsePricing("x")).toBeNull();
  });
  it("the test catalogue is the owner's final pricing: three plans, none says credits", () => {
    expect(MOCK_PRICING.plans.map((p) => p.id)).toEqual(["payg", "sales_assistant", "sales_lead_finder"]);
    expect(JSON.stringify(MOCK_PRICING)).not.toMatch(/credit/i);
  });
});

describe("the test state", () => {
  it("adds a top-up and the free start to the baseline", () => {
    expect(paiseOf(NOTHING)).toBe(BASE_PAISE);
    expect(paiseOf({ freeStart: true, topups: [{ id: "a1b2", at: "2026-11-13T05:00:00Z", paise: 100_000 }] })).toBe(BASE_PAISE + FREE_START_PAISE + 100_000);
  });
  it("checks the cookie on every read", () => {
    expect(parseState({ freeStart: false, topups: [] })).toEqual(NOTHING);
    expect(parseState({ freeStart: false, topups: [{ id: "a1b2", at: "2026-11-13T05:00:00Z", paise: 12345 }] })).toBeNull();
    expect(parseState({ freeStart: "yes", topups: [] })).toBeNull();
    expect(parseState({ freeStart: false, topups: [{ id: "a1b2", at: "nope", paise: TOPUP_CHOICES[0] }] })).toBeNull();
    expect(parseState(null)).toBeNull();
  });
});

describe("the invoices", () => {
  it("add 18 percent GST and show the GST inside the total", () => {
    expect(withGst(100_000)).toBe(118_000);
    expect(gstInside(118_000)).toBe(18_000);
  });
  it("lists the top-ups of this browser first, newest first, and marks every one as a test", () => {
    const list = mockInvoices({ freeStart: true, topups: [{ id: "ab12", at: "2026-11-13T09:00:00Z", paise: 50_000 }] });
    expect(list.map((i) => i.kind)).toEqual(["topup", "plan", "plan"]);
    expect(list[0]).toMatchObject({ totalPaise: 59_000, gstPaise: 9_000 });
    expect(list.every((i) => i.test)).toBe(true);
  });
});
