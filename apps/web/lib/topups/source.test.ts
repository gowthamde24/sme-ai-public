import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: (n: string, v: string) => jar.set(n, v), delete: (n: string) => jar.delete(n) }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
const api = vi.hoisted(() => ({ getUsageView: vi.fn(), getTopups: vi.fn(), getInvoices: vi.fn(), getUpgradePreview: vi.fn(), postTopup: vi.fn(), putTopupSettings: vi.fn(), postUpgrade: vi.fn() }));
vi.mock("@/lib/api/topups", () => api);
const plan = vi.hoisted(() => ({ readWorkspacePlan: vi.fn() }));
vi.mock("@/lib/plan/source", () => plan);

import { MOCK_COOKIE } from "./mock";
import { buyTopup, previewPlanUpgrade, readTopups, readUsage, refusalOf, saveTopupSettings, simulateUsage, upgradePlan } from "./source";

const CTX = { token: "tok", tenantId: "22222222-2222-4222-8222-222222222222" };
const ID = "11111111-1111-4111-8111-111111111111";
const SETTINGS = { autoMinutesPack: null, autoMessagesPack: null, autoMonthlyCapPaise: 0, overageMinutes: false, overageMessages: false, overageMonthlyCapPaise: 0 };

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00+05:30"));
  plan.readWorkspacePlan.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("off: the parts are not there", () => {
  it("every read is null and every move is not_available, and nothing is called", async () => {
    expect(await readUsage(CTX)).toBeNull();
    expect(await readTopups(CTX)).toBeNull();
    expect(await buyTopup(CTX, ID, "minutes_100", "test_ok")).toEqual({ ok: false, error: "not_available" });
    expect(await saveTopupSettings(CTX, SETTINGS)).toEqual({ ok: false, error: "not_available" });
    expect(await previewPlanUpgrade(CTX, "calls_1000")).toEqual({ ok: false, error: "not_available" });
    expect(await upgradePlan(CTX, "calls_1000", "test_ok")).toEqual({ ok: false, error: "not_available" });
    expect(await simulateUsage(CTX, 100)).toEqual({ ok: false, error: "not_available" });
    for (const f of Object.values(api)) expect(f).not.toHaveBeenCalled();
    expect(jar.size).toBe(0);
  });
});

describe("mock: the fake provider in one cookie", () => {
  beforeEach(() => vi.stubEnv("TOPUP_SCREENS", "mock"));
  it("reads the review default and calls no API", async () => {
    const t = await readTopups(CTX);
    expect(t?.mode).toBe("mock");
    expect(t?.usage.minutes.state).toBe("notice");
    expect(t?.packs.every((p) => p.isPlaceholder)).toBe(true);
    for (const f of Object.values(api)) expect(f).not.toHaveBeenCalled();
  });
  it("buying keeps the pack in the cookie; the same purchase id twice does not buy twice; a failed test payment buys nothing", async () => {
    expect(await buyTopup(CTX, ID, "minutes_100", "test_declined")).toEqual({ ok: false, error: "declined" });
    expect(jar.has(MOCK_COOKIE)).toBe(false);
    expect(await buyTopup(CTX, ID, "minutes_100", "test_ok")).toEqual({ ok: true });
    expect(await buyTopup(CTX, ID, "minutes_100", "test_ok")).toEqual({ ok: true });
    const t = await readTopups(CTX);
    expect(t?.history).toHaveLength(1);
    expect(t?.usage.minutes.topupBalance).toBe(100);
    expect(await buyTopup(CTX, ID, "minutes_300", "test_ok")).toEqual({ ok: false, error: "conflict" });
  });
  it("refuses a bad id, a bad pack code and a payment method that is not one of the two test choices", async () => {
    expect(await buyTopup(CTX, "x", "minutes_100", "test_ok")).toEqual({ ok: false, error: "invalid" });
    expect(await buyTopup(CTX, ID, "../etc", "test_ok")).toEqual({ ok: false, error: "invalid" });
    expect(await buyTopup(CTX, ID, "minutes_100", "visa")).toEqual({ ok: false, error: "invalid" });
    expect(await buyTopup(CTX, ID, "minutes_9", "test_ok")).toEqual({ ok: false, error: "pack_unknown" });
  });
  it("settings, preview and upgrade work on the cookie; the Plan part's own plan is used when it has one", async () => {
    expect(await saveTopupSettings(CTX, { ...SETTINGS, overageMinutes: true })).toEqual({ ok: false, error: "cap_required" });
    expect(await saveTopupSettings(CTX, { ...SETTINGS, overageMinutes: true, overageMonthlyCapPaise: 50000 })).toEqual({ ok: true });
    expect((await readTopups(CTX))?.settings).toMatchObject({ overageMinutes: true, overageMonthlyCapPaise: 50000 });
    plan.readWorkspacePlan.mockResolvedValue({ planId: "growth" });
    const p = await previewPlanUpgrade(CTX, "business");
    expect(p).toMatchObject({ ok: true, preview: { fromPlanId: "growth", toPlanId: "business", priceSet: true } });
    expect(await previewPlanUpgrade(CTX, "starter")).toEqual({ ok: false, error: "not_an_upgrade" });
    expect(await upgradePlan(CTX, "business", "test_declined")).toEqual({ ok: false, error: "declined" });
    expect(await upgradePlan(CTX, "business", "test_ok")).toEqual({ ok: true });
    expect((await readTopups(CTX))?.planId).toBe("business");
  });
  it("the test controls set the usage; the cookie stays small", async () => {
    expect(await simulateUsage(CTX, 100)).toEqual({ ok: true });
    expect((await readUsage(CTX))?.minutes.state).toBe("stopped");
    expect((await readUsage(CTX))?.queuedCalls).toBe(12);
    expect(jar.get(MOCK_COOKIE)!.length).toBeLessThan(3500);
    expect(await simulateUsage(CTX, 33)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("on: C1's API with the person's own token", () => {
  beforeEach(() => vi.stubEnv("TOPUP_SCREENS", "1"));
  const usage = { period: { start: "2026-10-01", end: "2026-10-31", daysLeft: 26 }, minutes: {}, messages: {}, queuedCalls: 3 };
  it("reads usage; a failed read is null, a refused session goes to the sign-in page", async () => {
    api.getUsageView.mockResolvedValueOnce(usage);
    expect(await readUsage(CTX)).toBe(usage);
    expect(api.getUsageView).toHaveBeenCalledWith("tok", CTX.tenantId);
    api.getUsageView.mockRejectedValueOnce(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await readUsage(CTX)).toBeNull();
    api.getUsageView.mockRejectedValueOnce(new ApiAuthError());
    await expect(readUsage(CTX)).rejects.toThrow("redirect:/login");
  });
  it("reads the topups with the usage and the invoices; the invoices failing still draws the part", async () => {
    api.getUsageView.mockResolvedValue(usage);
    api.getTopups.mockResolvedValue({ mode: "on", planId: null, usage, packs: [], balance: {}, settings: {}, history: [], invoices: [] });
    api.getInvoices.mockRejectedValue(new ApiRequestError(500, "boom", "x"));
    expect(await readTopups(CTX)).toMatchObject({ mode: "on", invoices: [] });
    api.getInvoices.mockResolvedValue([{ number: "S19-1" }]);
    expect((await readTopups(CTX))?.invoices).toHaveLength(1);
    api.getTopups.mockRejectedValue(new Error("not the contract"));
    expect(await readTopups(CTX)).toBeNull();
  });
  it("a purchase goes with pm_fake_ok / pm_fake_declined and the id the browser made", async () => {
    api.postTopup.mockResolvedValue(undefined);
    expect(await buyTopup(CTX, ID, "minutes_300", "test_ok")).toEqual({ ok: true });
    expect(api.postTopup).toHaveBeenCalledWith("tok", CTX.tenantId, ID, "minutes_300", "pm_fake_ok");
    await buyTopup(CTX, ID, "minutes_300", "test_declined");
    expect(api.postTopup).toHaveBeenLastCalledWith("tok", CTX.tenantId, ID, "minutes_300", "pm_fake_declined");
  });
  it("the API's refusals become our words", async () => {
    const refuse = (status: number, code: string) => api.postTopup.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
    const cases: [number, string, string][] = [[403, "mfa_required", "mfa"], [403, "workspace_read_only", "read_only"], [402, "payment_method_declined", "declined"], [409, "no_subscription", "no_plan"], [409, "purchase_id_used", "conflict"], [422, "pack_unknown", "pack_unknown"], [422, "cap_required", "cap_required"], [503, "billing_unavailable", "not_available"], [403, "something_else", "forbidden"], [422, "other", "invalid"], [500, "boom", "not_available"]];
    for (const [status, code, want] of cases) {
      refuse(status, code);
      expect(await buyTopup(CTX, ID, "minutes_300", "test_ok"), code).toEqual({ ok: false, error: want });
    }
    api.postTopup.mockRejectedValueOnce(new ApiAuthError());
    await expect(buyTopup(CTX, ID, "minutes_300", "test_ok")).rejects.toThrow("redirect:/login");
    expect(() => refusalOf(new ApiAuthError())).toThrow("redirect:/login");
  });
  it("settings, preview and upgrade call the API; the test controls do not exist", async () => {
    api.putTopupSettings.mockResolvedValue({});
    expect(await saveTopupSettings(CTX, SETTINGS)).toEqual({ ok: true });
    expect(api.putTopupSettings).toHaveBeenCalledWith("tok", CTX.tenantId, SETTINGS);
    api.getUpgradePreview.mockResolvedValue({ toPlanId: "calls_1000" });
    expect(await previewPlanUpgrade(CTX, "calls_1000")).toEqual({ ok: true, preview: { toPlanId: "calls_1000" } });
    api.getUpgradePreview.mockRejectedValueOnce(new ApiRequestError(409, "not_an_upgrade", "x"));
    expect(await previewPlanUpgrade(CTX, "calls_1000")).toEqual({ ok: false, error: "not_an_upgrade" });
    api.postUpgrade.mockResolvedValue(undefined);
    expect(await upgradePlan(CTX, "calls_1000", "test_ok")).toEqual({ ok: true });
    expect(api.postUpgrade).toHaveBeenCalledWith("tok", CTX.tenantId, "calls_1000", "pm_fake_ok");
    expect(await simulateUsage(CTX, 100)).toEqual({ ok: false, error: "not_available" });
    expect(jar.size).toBe(0);
  });
});
