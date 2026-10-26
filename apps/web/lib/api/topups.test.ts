import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";

const apiRequest = vi.fn();
vi.mock("./client", async (importOriginal) => ({ ...(await importOriginal<typeof import("./client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { getInvoices, getTopups, getUpgradePreview, getUsageView, parseInvoice, parseMeter, parsePack, parsePurchase, parseSettings, parseTopups, parseUpgradePreview, parseUsageView, postTopup, postUpgrade, putTopupSettings } from "./topups";

/**
 * The shapes of contract-topups.md (job E2), copied from the contract text. ONE place to change when C1's generated types differ: these fixtures and lib/api/topups.ts.
 */
const T = "22222222-2222-4222-8222-222222222222";
const PID = "33333333-3333-4333-8333-333333333333";
const METER = { kind: "call_minutes", unit: "minutes", used: 241.5, allowance: 300, remaining: 58.5, percent: 80, state: "notice", included: true, topup: 0, plan_allowance: 300, topup_balance: 200, next_topup_expiry: "2027-01-12", projected_run_out_on: "2026-11-21", runs_out_before_period_end: true, blocked: false, overage: null, queued: 12 };
const METER2 = { ...METER, kind: "whatsapp_messages", unit: "messages", used: 10, remaining: 290, percent: 3, state: "ok", topup_balance: 0, next_topup_expiry: null, projected_run_out_on: null, runs_out_before_period_end: false, queued: 0 };
const USAGE = { period: { start: "2026-10-01", end: "2026-10-31", timezone: "Asia/Kolkata", days_left: 26 }, usage: { call_minutes: METER, whatsapp_messages: METER2 }, notices: [], queued_calls: 12 };
const PACK = { code: "minutes_100", kind: "call_minutes", units: 100, price_paise: 40000, gst_rate_bp: 1800, gst_paise: 7200, total_paise: 47200, price_is_placeholder: true };
const SETTINGS = { auto_minutes_pack: null, auto_messages_pack: null, auto_monthly_cap_paise: 0, overage_minutes: false, overage_messages: false, overage_monthly_cap_paise: 0, overage_rate_paise_per_minute: 500, overage_rate_paise_per_message: 70, auto_spent_paise: 0, overage_spent_paise: 0 };
const PURCHASE = { id: PID, pack_code: "minutes_300", kind: "call_minutes", units: 300, source: "manual", price_paise: 108000, total_paise: 127440, purchased_at: "2026-10-13T05:00:00Z", expires_at: "2027-01-11T05:00:00Z", units_left: 200, invoice_id: "44444444-4444-4444-8444-444444444444" };
const INVOICE = { id: "44444444-4444-4444-8444-444444444444", number: "S19-2610-000001", kind: "topup", description: "Top-up: 300 minutes", issued_at: "2026-10-13T05:00:00Z", period_start: "2026-10-01", taxable_paise: 108000, gst_rate_bp: 1800, cgst_paise: 0, sgst_paise: 0, igst_paise: 19440, total_paise: 127440, seller: { name: "Test seller", state_code: "36", gstin: null }, buyer: { gstin: "29ABCDE1234F1Z5", state_code: "29" }, fake: true, payment_status: "paid_fake" };
const TOPUPS = { packs: [PACK], balance: { call_minutes: { units: 200, lots: [{ purchase_id: PID, units_left: 200, purchased_at: "2026-10-13T05:00:00Z", expires_at: "2027-01-11T05:00:00Z" }] }, whatsapp_messages: { units: 0, lots: [] } }, settings: SETTINGS, history: [PURCHASE] };
const PREVIEW = { from_plan_id: "calls_300", to_plan_id: "calls_1000", price_set: true, days_in_period: 30, days_left: 11, prorated_paise: 7333, gst_paise: 1320, total_paise: 8653, new_allowances: { call_minutes: 1000, whatsapp_messages: 1000 }, effective: "now", note: "x" };

beforeEach(() => vi.clearAllMocks());

describe("the meters and the usage view", () => {
  it("reads every field of a meter, in the screens' names", () => {
    expect(parseMeter(METER)).toEqual({ kind: "call_minutes", used: 241.5, allowance: 300, remaining: 58.5, percent: 80, state: "notice", included: true, planAllowance: 300, topupBalance: 200, nextTopupExpiry: "2027-01-12", projectedRunOutOn: "2026-11-21", runsOutBeforePeriodEnd: true, blocked: false, overage: null, queued: 12 });
  });
  it("a plan with no ceiling has null allowance, remaining and percent; the overage block is read when present", () => {
    const m = parseMeter({ ...METER, allowance: null, remaining: null, percent: null, overage: { enabled: true, units: 12, spent_paise: 6000, cap_paise: 50000, rate_paise_per_unit: 500 } });
    expect(m).toMatchObject({ allowance: null, remaining: null, percent: null, overage: { enabled: true, units: 12, spentPaise: 6000, capPaise: 50000, ratePaisePerUnit: 500 } });
  });
  it("refuses a meter that is not the contract: a bad state, a bad date, a negative count, a missing field", () => {
    for (const bad of [{ ...METER, state: "paused" }, { ...METER, projected_run_out_on: "21 Nov" }, { ...METER, used: -1 }, { ...METER, kind: "ai_tokens" }, { ...METER, queued: 1.5 }, { ...METER, blocked: "no" }, { ...METER, topup_balance: undefined }, "x", null]) {
      expect(() => parseMeter(bad), JSON.stringify(bad)).toThrow(ApiContractError);
    }
  });
  it("the usage view carries the period, both meters and the queued calls", () => {
    const u = parseUsageView(USAGE);
    expect(u.period).toEqual({ start: "2026-10-01", end: "2026-10-31", daysLeft: 26 });
    expect(u.minutes.kind).toBe("call_minutes");
    expect(u.messages.kind).toBe("whatsapp_messages");
    expect(u.queuedCalls).toBe(12);
    expect(parseUsageView({ ...USAGE, queued_calls: undefined }).queuedCalls).toBe(12); // falls back to the meter's own count
  });
  it("refuses the meters swapped, a missing period or a bad queued count", () => {
    expect(() => parseUsageView({ ...USAGE, usage: { call_minutes: METER2, whatsapp_messages: METER } })).toThrow(ApiContractError);
    expect(() => parseUsageView({ ...USAGE, period: { start: "2026-10-01" } })).toThrow(ApiContractError);
    expect(() => parseUsageView({ ...USAGE, queued_calls: -2 })).toThrow(ApiContractError);
  });
});

describe("packs, balance, settings, purchases", () => {
  it("reads a pack with its GST and the placeholder flag", () => {
    expect(parsePack(PACK)).toEqual({ code: "minutes_100", kind: "call_minutes", units: 100, pricePaise: 40000, gstRateBp: 1800, gstPaise: 7200, totalPaise: 47200, isPlaceholder: true });
    expect(() => parsePack({ ...PACK, code: "minutes 100!" })).toThrow(ApiContractError);
    expect(() => parsePack({ ...PACK, price_paise: 400.5 })).toThrow(ApiContractError);
    expect(() => parsePack({ ...PACK, price_is_placeholder: undefined })).toThrow(ApiContractError);
  });
  it("the two switches are off in the default settings", () => {
    expect(parseSettings(SETTINGS)).toMatchObject({ autoMinutesPack: null, autoMessagesPack: null, autoMonthlyCapPaise: 0, overageMinutes: false, overageMessages: false, overageRatePaisePerMinute: 500, overageRatePaisePerMessage: 70 });
    expect(() => parseSettings({ ...SETTINGS, overage_minutes: "false" })).toThrow(ApiContractError);
  });
  it("a purchase and its source", () => {
    expect(parsePurchase(PURCHASE)).toMatchObject({ id: PID, packCode: "minutes_300", source: "manual", unitsLeft: 200, totalPaise: 127440 });
    expect(() => parsePurchase({ ...PURCHASE, source: "stolen" })).toThrow(ApiContractError);
    expect(() => parsePurchase({ ...PURCHASE, id: "x" })).toThrow(ApiContractError);
  });
  it("the whole TopupsOut joins the usage it is read with", () => {
    const view = parseTopups(TOPUPS, parseUsageView(USAGE));
    expect(view.mode).toBe("on");
    expect(view.packs).toHaveLength(1);
    expect(view.balance.call_minutes).toMatchObject({ units: 200, lots: [{ purchaseId: PID, unitsLeft: 200 }] });
    expect(view.history).toHaveLength(1);
    expect(view.usage.queuedCalls).toBe(12);
    expect(() => parseTopups({ ...TOPUPS, balance: {} }, parseUsageView(USAGE))).toThrow(ApiContractError);
    expect(() => parseTopups({ ...TOPUPS, packs: "x" }, parseUsageView(USAGE))).toThrow(ApiContractError);
  });
});

describe("invoices carry the GST fields", () => {
  it("IGST for another state, the buyer's GSTIN when it is set, the fake flag", () => {
    expect(parseInvoice(INVOICE)).toMatchObject({ number: "S19-2610-000001", kind: "topup", taxablePaise: 108000, gstRateBp: 1800, cgstPaise: 0, sgstPaise: 0, igstPaise: 19440, totalPaise: 127440, buyerGstin: "29ABCDE1234F1Z5", sellerGstin: null, fake: true, paymentStatus: "paid_fake" });
  });
  it("CGST and SGST for the same state", () => {
    expect(parseInvoice({ ...INVOICE, cgst_paise: 9720, sgst_paise: 9720, igst_paise: 0 })).toMatchObject({ cgstPaise: 9720, sgstPaise: 9720, igstPaise: 0 });
  });
  it("refuses a kind the contract does not have and a payment status with spaces", () => {
    expect(() => parseInvoice({ ...INVOICE, kind: "refund" })).toThrow(ApiContractError);
    expect(() => parseInvoice({ ...INVOICE, payment_status: "paid fake" })).toThrow(ApiContractError);
    expect(() => parseInvoice({ ...INVOICE, seller: null })).toThrow(ApiContractError);
  });
});

describe("the upgrade preview", () => {
  it("reads the pro-rata amounts the API worked out, and 'now'", () => {
    expect(parseUpgradePreview(PREVIEW)).toEqual({ fromPlanId: "calls_300", toPlanId: "calls_1000", priceSet: true, daysInPeriod: 30, daysLeft: 11, proratedPaise: 7333, gstPaise: 1320, totalPaise: 8653, newAllowances: { callMinutes: 1000, messages: 1000 }, effective: "now" });
  });
  it("a plan with no price set has null amounts", () => {
    expect(parseUpgradePreview({ ...PREVIEW, price_set: false, prorated_paise: null, gst_paise: null, total_paise: null })).toMatchObject({ priceSet: false, proratedPaise: null, gstPaise: null, totalPaise: null });
  });
  it("refuses an effective time other than now", () => {
    expect(() => parseUpgradePreview({ ...PREVIEW, effective: "next_period" })).toThrow(ApiContractError);
  });
});

describe("the calls (paths and bodies of contract-topups.md)", () => {
  it("reads usage, topups, invoices and the preview with the person's token", async () => {
    apiRequest.mockResolvedValueOnce(USAGE);
    await getUsageView("tok", T);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/billing/usage`, "tok");
    apiRequest.mockResolvedValueOnce(TOPUPS);
    await getTopups("tok", T, parseUsageView(USAGE));
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/billing/topups`, "tok");
    apiRequest.mockResolvedValueOnce({ items: [INVOICE], next_cursor: null });
    expect(await getInvoices("tok", T)).toHaveLength(1);
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/billing/invoices`, "tok");
    apiRequest.mockResolvedValueOnce(PREVIEW);
    await getUpgradePreview("tok", T, "calls_1000");
    expect(apiRequest).toHaveBeenLastCalledWith(`/v1/tenants/${T}/billing/upgrade-preview?plan_id=calls_1000`, "tok");
  });
  it("a purchase sends the id the browser made, the pack and the checkout ref", async () => {
    apiRequest.mockResolvedValue({ purchase: PURCHASE, invoice: INVOICE, usage: METER });
    await postTopup("tok", T, PID, "minutes_300", "pm_fake_ok");
    const [path, token, init] = apiRequest.mock.calls[0];
    expect(path).toBe(`/v1/tenants/${T}/billing/topups`);
    expect(token).toBe("tok");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ purchase_id: PID, pack_code: "minutes_300", checkout_ref: "pm_fake_ok" });
  });
  it("an answer that is not a purchase and an invoice is an error, not a success", async () => {
    apiRequest.mockResolvedValue({ purchase: { id: "x" }, invoice: INVOICE });
    await expect(postTopup("tok", T, PID, "minutes_300", "pm_fake_ok")).rejects.toThrow(ApiContractError);
  });
  it("the settings are put whole, in the API's names", async () => {
    apiRequest.mockResolvedValue(SETTINGS);
    await putTopupSettings("tok", T, { autoMinutesPack: "minutes_100", autoMessagesPack: null, autoMonthlyCapPaise: 200000, overageMinutes: false, overageMessages: true, overageMonthlyCapPaise: 50000 });
    const [path, , init] = apiRequest.mock.calls[0];
    expect(path).toBe(`/v1/tenants/${T}/billing/topups/settings`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ auto_minutes_pack: "minutes_100", auto_messages_pack: null, auto_monthly_cap_paise: 200000, overage_minutes: false, overage_messages: true, overage_monthly_cap_paise: 50000 });
  });
  it("an upgrade sends the plan and the checkout ref; the invoice may be null (no price yet)", async () => {
    apiRequest.mockResolvedValue({ billing: {}, invoice: null });
    await postUpgrade("tok", T, "calls_1000", "pm_fake_ok");
    const [path, , init] = apiRequest.mock.calls[0];
    expect(path).toBe(`/v1/tenants/${T}/billing/upgrade`);
    expect(JSON.parse(init.body)).toEqual({ plan_id: "calls_1000", checkout_ref: "pm_fake_ok" });
  });
  it("a workspace id that is not a uuid never reaches the network", async () => {
    await expect(getUsageView("tok", "../x")).rejects.toThrow(ApiContractError);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
