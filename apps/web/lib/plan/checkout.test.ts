import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api/client";

const apiRequest = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { RAZORPAY_REF, parseCheckout } from "./api";
import { razorpayCheckout } from "./flag";
import { startCheckout, startPlanTrial } from "./source";

const CTX = { token: "tok", tenantId: "22222222-2222-4222-8222-222222222222" };
const RZP = { provider: "razorpay", key_id: "rzp_test_AbC123xyz", subscription_id: "sub_Qw12Er34Ty", plan_id: "growth", amount_paise: 249900, currency: "INR" };
const FAKE = { provider: "fake", key_id: null, subscription_id: null, plan_id: "growth", amount_paise: null, currency: "INR" };
const SIG = "a".repeat(64);
const REF = `sub_Qw12Er34Ty.pay_Zx98Cv76Bn.${SIG}`;
const refuse = (status: number, code: string) => new ApiRequestError(status, code, "the API's own sentence");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PLAN_SCREENS", "1");
  vi.stubEnv("RAZORPAY_CHECKOUT", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("parseCheckout (C1's POST /billing/checkout)", () => {
  it("reads a Razorpay session and a fake one", () => {
    expect(parseCheckout(RZP)).toEqual({ provider: "razorpay", keyId: "rzp_test_AbC123xyz", subscriptionId: "sub_Qw12Er34Ty", planId: "growth", amountPaise: 249900, currency: "INR" });
    expect(parseCheckout(FAKE)).toMatchObject({ provider: "fake", keyId: null, subscriptionId: null, amountPaise: null });
  });
  it.each([
    ["a live key", { ...RZP, key_id: "rzp_live_AbC123xyz" }],
    ["a missing subscription", { ...RZP, subscription_id: null }],
    ["a key with odd characters", { ...RZP, key_id: "rzp_test_<script>" }],
    ["another currency", { ...RZP, currency: "USD" }],
    ["a negative amount", { ...RZP, amount_paise: -1 }],
    ["an unknown provider", { ...RZP, provider: "stripe" }],
    ["not an object", "x"],
  ])("refuses %s", (_n, json) => {
    expect(() => parseCheckout(json)).toThrow();
  });
});

describe("startCheckout", () => {
  it("flag off, or the plan screens not on the API: the fake provider's test choices, the API is not asked", async () => {
    vi.stubEnv("RAZORPAY_CHECKOUT", "");
    expect(await startCheckout(CTX, "growth")).toEqual({ ok: true, provider: "fake" });
    vi.stubEnv("RAZORPAY_CHECKOUT", "1");
    vi.stubEnv("PLAN_SCREENS", "mock");
    expect(await startCheckout(CTX, "growth")).toEqual({ ok: true, provider: "fake" });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("Razorpay: only the PUBLIC values go to the screen", async () => {
    apiRequest.mockResolvedValue(RZP);
    const r = await startCheckout(CTX, "growth");
    expect(r).toEqual({ ok: true, provider: "razorpay", keyId: "rzp_test_AbC123xyz", subscriptionId: "sub_Qw12Er34Ty", amountPaise: 249900 });
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${CTX.tenantId}/billing/checkout`, "tok", { method: "POST", body: JSON.stringify({ plan_id: "growth" }) });
  });

  it("the fake provider, or an API without the route yet (404, 405): the test choices stay", async () => {
    apiRequest.mockResolvedValueOnce(FAKE);
    expect(await startCheckout(CTX, "growth")).toEqual({ ok: true, provider: "fake" });
    apiRequest.mockRejectedValueOnce(refuse(404, "not_found"));
    expect(await startCheckout(CTX, "growth")).toEqual({ ok: true, provider: "fake" });
    apiRequest.mockRejectedValueOnce(refuse(405, "method_not_allowed"));
    expect(await startCheckout(CTX, "growth")).toEqual({ ok: true, provider: "fake" });
  });

  it.each([
    [403, "forbidden", "forbidden"],
    [409, "plan_has_no_price", "no_price"],
    [409, "trial_already_started", "already"],
    [422, "plan_unknown", "invalid"],
    [503, "billing_unavailable", "unavailable"],
    [500, "boom", "unavailable"],
  ])("%s %s is %s, in our words (never the API's)", async (status, code, error) => {
    apiRequest.mockRejectedValueOnce(refuse(status, code));
    const r = await startCheckout(CTX, "growth");
    expect(r).toEqual({ ok: false, error });
  });

  it("a live key in the answer is refused", async () => {
    apiRequest.mockResolvedValue({ ...RZP, key_id: "rzp_live_AbC123xyz" });
    expect(await startCheckout(CTX, "growth")).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("starting the plan with what Razorpay's Checkout returned", () => {
  it("the ref is checked to the letter and sent as the checkout_ref; with the flag off it is not accepted", async () => {
    expect(RAZORPAY_REF.test(REF)).toBe(true);
    for (const bad of [`sub_Qw12Er34Ty.pay_Zx98Cv76Bn.${"g".repeat(64)}`, `sub_x.pay_y.${SIG}`, `${REF}.extra`, "pm_fake_ok.x.y", `<${REF}>`]) expect(RAZORPAY_REF.test(bad), bad).toBe(false);
    apiRequest.mockResolvedValue({ plan: { id: "growth", kind: "main", sort: 1, name: { en: "Growth" }, price_paise_monthly: null, allowances: { call_minutes: 0, whatsapp_messages: 0 }, limits: { users: 1, workspaces: 1 } }, subscription: null });
    await startPlanTrial(CTX, "growth", REF).catch(() => undefined);
    expect(apiRequest).toHaveBeenCalledWith(`/v1/tenants/${CTX.tenantId}/billing/trial`, "tok", { method: "POST", body: JSON.stringify({ plan_id: "growth", checkout_ref: REF }) });
    apiRequest.mockClear();
    vi.stubEnv("RAZORPAY_CHECKOUT", "");
    expect(await startPlanTrial(CTX, "growth", REF)).toEqual({ ok: false, error: "no_payment_method" });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("the flag reads only the exact word 1", () => {
    expect(razorpayCheckout("1")).toBe(true);
    for (const v of ["", "0", "true", "mock"]) expect(razorpayCheckout(v)).toBe(false);
  });
});
