import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ req: vi.fn(), mode: { v: "mock" as "off" | "on" | "mock" }, jar: new Map<string, unknown>(), balance: vi.fn() }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.req(...a) }));
vi.mock("@/lib/screens/flag", () => ({ billingV2: () => h.mode.v, balanceScreens: () => "off" }));
vi.mock("@/lib/mock/jar", () => ({
  readJar: async (name: string, parse: (v: unknown) => unknown, fallback: unknown) => (h.jar.has(name) ? (parse(h.jar.get(name)) ?? fallback) : fallback),
  writeJar: async (name: string, value: unknown) => (h.jar.set(name, JSON.parse(JSON.stringify(value))), true),
}));
vi.mock("@/lib/billing-v6/source", () => ({ readBillingBalance: (...a: unknown[]) => h.balance(...a) }));
vi.mock("@/lib/billing-v6/mock-state", () => ({ readState: async () => ({ freeStart: false, topups: [] }) }));

import { ApiRequestError } from "./client";
import { deriveWarn, mockWallet, parseUsage, readWallet, saveLimit } from "./wallet";

const T = "11111111-1111-4111-8111-111111111111";
const line = (over: Record<string, unknown> = {}) => ({ feature: "calls", unit: "minute", used: 212.5, included: 500, unit_paise: 500, spent_paise: 0, limit_paise: null, ...over });

beforeEach(() => {
  h.req.mockReset();
  h.balance.mockReset();
  h.jar.clear();
  h.mode.v = "mock";
});

describe("the 80% and 100% marks", () => {
  const base = { feature: "calls" as const, used: 0, included: 500, spentPaise: 0, limitPaise: null };
  it("of the included minutes when no limit is set: 80% warns, 100% says all used (calls go on, from the wallet)", () => {
    expect(deriveWarn({ ...base, used: 399 })).toEqual({ warn: "none", paused: false });
    expect(deriveWarn({ ...base, used: 400 })).toEqual({ warn: "at80", paused: false });
    expect(deriveWarn({ ...base, used: 500 })).toEqual({ warn: "at100", paused: false });
  });
  it("of the money spent against a spending limit when one is set: 100% stops the feature for the month", () => {
    expect(deriveWarn({ ...base, used: 900, spentPaise: 160_000, limitPaise: 200_000 })).toEqual({ warn: "at80", paused: false });
    expect(deriveWarn({ ...base, used: 900, spentPaise: 200_000, limitPaise: 200_000 })).toEqual({ warn: "at100", paused: true });
  });
  it("WhatsApp and numbers with no limit never warn; Pay as you go has no included minutes to run out", () => {
    expect(deriveWarn({ feature: "whatsapp", used: 99, included: null, spentPaise: 99_999, limitPaise: null })).toEqual({ warn: "none", paused: false });
    expect(deriveWarn({ ...base, included: null, used: 400 })).toEqual({ warn: "none", paused: false });
  });
});

describe("C1's usage answer (proposed: GET /billing/usage)", () => {
  it("reads the lines, the period and the closed words", () => {
    const u = parseUsage({ period: { day: 6, days: 30 }, lines: [line(), line({ feature: "whatsapp", unit: "message", used: 40, included: null, unit_paise: null, spent_paise: 8600 })] });
    expect(u?.day).toBe(6);
    expect(u?.lines.map((l) => [l.feature, l.unit, l.used, l.included, l.warn])).toEqual([["calls", "minute", 212.5, 500, "none"], ["whatsapp", "message", 40, null, "none"]]);
  });
  it("takes the API's warn when it sends one, else works it out", () => {
    expect(parseUsage({ lines: [line({ used: 450 })] })?.lines[0].warn).toBe("at80");
    expect(parseUsage({ lines: [line({ used: 450, warn: "at100", paused: true })] })?.lines[0]).toMatchObject({ warn: "at100", paused: true });
    expect(parseUsage({ lines: [line({ used: 450, warn: "scary" })] })?.lines[0].warn).toBe("at80");
  });
  it("skips a feature of a newer API, refuses an odd line", () => {
    expect(parseUsage({ lines: [line(), { feature: "sms", used: 1, spent_paise: 0 }] })?.lines).toHaveLength(1);
    expect(parseUsage({ lines: [line({ used: -1 })] })).toBeNull();
    expect(parseUsage({ lines: [line({ used: 0.3 })] })).toBeNull();
    expect(parseUsage({ lines: [line({ spent_paise: 1.5 })] })).toBeNull();
    expect(parseUsage({ lines: "x" })).toBeNull();
    expect(parseUsage(null)).toBeNull();
  });
  it("a number has no spending limit even if the API sends one", () => {
    expect(parseUsage({ lines: [line({ feature: "numbers", unit: "number", used: 2, included: 1, unit_paise: 29900, spent_paise: 29900, limit_paise: 50000 })] })?.lines[0].limitPaise).toBeNull();
  });
});

describe("the made-up months (BILLING_V2=mock)", () => {
  it("the middle of a normal month on Pro: nothing warns", () => {
    const w = mockWallet("normal", {});
    expect(w.source).toBe("mock");
    expect(w.planName).toBe("Pro");
    expect(w.lines.map((l) => l.feature)).toEqual(["calls", "numbers", "find_customers", "whatsapp"]);
    expect(w.lines.every((l) => l.warn === "none")).toBe(true);
  });
  it("low80: the minutes are at 80% and the wallet is low", () => {
    const w = mockWallet("low80", {});
    expect(w.low).toBe(true);
    expect(w.lines.find((l) => l.feature === "calls")).toMatchObject({ used: 400, warn: "at80", paused: false });
  });
  it("full100: all 500 minutes used, the extra ones come from the wallet at ₹5", () => {
    expect(mockWallet("full100", {}).lines.find((l) => l.feature === "calls")).toMatchObject({ used: 536, warn: "at100", paused: false, spentPaise: 18_000 });
  });
  it("over: the calls limit of ₹2,000 is reached, so calls are stopped", () => {
    expect(mockWallet("over", {}).lines.find((l) => l.feature === "calls")).toMatchObject({ limitPaise: 200_000, spentPaise: 200_000, warn: "at100", paused: true });
  });
  it("upgrade: Pay as you go, 420 minutes", () => {
    const w = mockWallet("upgrade", {});
    expect(w.planKey).toBe("payg");
    expect(w.lines.find((l) => l.feature === "calls")).toMatchObject({ used: 420, included: null, warn: "none" });
  });
  it("numbers: three numbers, two extra at ₹499", () => {
    expect(mockWallet("numbers", {}).lines.find((l) => l.feature === "numbers")).toMatchObject({ used: 3, included: 1, spentPaise: 99_800 });
  });
  it("a limit chosen on the screen is kept and warns by itself", async () => {
    expect(await saveLimit("tok", T, "calls", 20_000)).toEqual({ ok: true });
    const w = await readWallet("tok", T, "normal");
    expect(w?.lines.find((l) => l.feature === "calls")).toMatchObject({ limitPaise: 20_000 });
    expect(await saveLimit("tok", T, "calls", null)).toEqual({ ok: true });
    expect((await readWallet("tok", T, "normal"))?.lines.find((l) => l.feature === "calls")?.limitPaise).toBeNull();
  });
  it("an unknown ?demo= is the normal month", async () => {
    expect((await readWallet("tok", T, "nonsense"))?.planName).toBe("Pro");
  });
});

describe("limits", () => {
  it("only calls, searches and WhatsApp can have one, and the amount is a whole number of at least ₹100", async () => {
    expect(await saveLimit("tok", T, "numbers", 20_000)).toEqual({ ok: false, error: "invalid" });
    expect(await saveLimit("tok", T, "calls", 99)).toEqual({ ok: false, error: "invalid" });
    expect(await saveLimit("tok", T, "calls", 2000.5)).toEqual({ ok: false, error: "invalid" });
    expect(await saveLimit("tok", "not-a-uuid", "calls", 20_000)).toEqual({ ok: false, error: "not_available" });
  });
  it("with the API: PUT /billing/limits/{feature}; a missing route says 'not available', a 422 says 'invalid'", async () => {
    h.mode.v = "on";
    h.req.mockResolvedValueOnce({});
    expect(await saveLimit("tok", T, "find_customers", 50_000)).toEqual({ ok: true });
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/billing/limits/find_customers`, "tok", { method: "PUT", body: JSON.stringify({ limit_paise: 50_000 }) });
    h.req.mockRejectedValueOnce(new ApiRequestError(404, "not_found", "x"));
    expect(await saveLimit("tok", T, "calls", 50_000)).toEqual({ ok: false, error: "not_available" });
    h.req.mockRejectedValueOnce(new ApiRequestError(422, "limit_invalid", "x"));
    expect(await saveLimit("tok", T, "calls", 50_000)).toEqual({ ok: false, error: "invalid" });
  });
});

describe("with the API (BILLING_V2=1)", () => {
  const BAL = { paise: 155_000, minutesEstimate: 310, low: false, planId: "sales_assistant", planName: "Pro", topupAvailable: true, freeStartGranted: true, freeStartLeftText: null, includedMinutes: 500, includedMinutesLeft: 342, subscription: { periodEnd: "2026-12-13T05:00:00Z" } };
  it("the usage route answered: its lines are shown", async () => {
    h.mode.v = "on";
    h.balance.mockResolvedValue(BAL);
    h.req.mockResolvedValue({ period: { day: 6, days: 30 }, lines: [line()] });
    const w = await readWallet("tok", T);
    expect(w).toMatchObject({ source: "api", planKey: "pro", balancePaise: 155_000, limitsAvailable: true, day: 6 });
    expect(h.req).toHaveBeenCalledWith(`/v1/tenants/${T}/billing/usage`, "tok");
  });
  it("the usage route is not there yet: the real balance and the minutes of the plan are shown, nothing is made up, no limit can be set", async () => {
    h.mode.v = "on";
    h.balance.mockResolvedValue(BAL);
    h.req.mockRejectedValue(new ApiRequestError(404, "not_found", "x"));
    const w = await readWallet("tok", T);
    expect(w).toMatchObject({ source: "balance", limitsAvailable: false, balancePaise: 155_000 });
    expect(w?.lines).toHaveLength(1);
    expect(w?.lines[0]).toMatchObject({ feature: "calls", used: 158, included: 500 });
  });
  it("no balance: null", async () => {
    h.mode.v = "on";
    h.balance.mockResolvedValue(null);
    expect(await readWallet("tok", T)).toBeNull();
  });
  it("off: null", async () => {
    h.mode.v = "off";
    expect(await readWallet("tok", T)).toBeNull();
  });
});
