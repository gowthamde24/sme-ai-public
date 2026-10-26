import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>(), get: vi.fn(), put: vi.fn(), clear: vi.fn(), ws: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));
vi.mock("@/lib/api/campaign-call-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/campaign-call-settings")>()),
  getCampaignCalls: (...a: unknown[]) => h.get(...a),
  putCampaignOverride: (...a: unknown[]) => h.put(...a),
  clearCampaignOverride: (...a: unknown[]) => h.clear(...a),
}));

vi.mock("@/lib/api/call-settings", async (orig) => ({ ...(await orig<typeof import("@/lib/api/call-settings")>()), getCallSettings: (...a: unknown[]) => h.ws(...a) }));

import { ApiRequestError } from "@/lib/api/client";

import { clearCampaign, MOCK_COOKIE, readCampaignCalls, saveCampaignOverride } from "./campaign-source";
import { defaultCallSettings } from "./types";
import { parseCampaignCalls } from "@/lib/api/campaign-call-settings";

const CTX = { token: "tok", tenantId: "22222222-2222-2222-2222-222222222222" };
const C1 = "33333333-3333-3333-3333-333333333333";
const base = defaultCallSettings(null);

beforeEach(() => {
  h.jar.clear();
  h.get.mockReset();
  h.put.mockReset();
  h.clear.mockReset();
  vi.unstubAllEnvs();
});

describe("a campaign's call settings, in the test screens (CALL_SETTINGS_SCREENS=mock)", () => {
  it("is off when the screens are off", async () => {
    expect(await readCampaignCalls(CTX, C1, null)).toEqual({ mode: "off" });
    expect(await saveCampaignOverride(CTX, C1, {}, null)).toEqual({ ok: false, error: "not_available" });
    expect(await clearCampaign(CTX, C1)).toEqual({ ok: false, error: "not_available" });
  });
  it("follows the workspace until an override is saved, then shows the difference, and clears it again", async () => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "mock");
    const first = await readCampaignCalls(CTX, C1, null);
    expect(first).toMatchObject({ mode: "ok", overridden: [] });
    expect(await saveCampaignOverride(CTX, C1, { concurrent_calls: 3 }, null)).toEqual({ ok: true });
    const second = await readCampaignCalls(CTX, C1, null);
    expect(second.mode === "ok" && second.effective.concurrent_calls).toBe(3);
    expect(second.mode === "ok" && second.overridden).toEqual(["concurrent_calls"]);
    expect(second.mode === "ok" && second.base.concurrent_calls).toBe(base.concurrent_calls);
    expect(await clearCampaign(CTX, C1)).toEqual({ ok: true });
    expect(await readCampaignCalls(CTX, C1, null)).toMatchObject({ mode: "ok", overridden: [] });
  });
  it("refuses an override that is not valid, a field the campaign may not change, and a cookie too big", async () => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "mock");
    expect(await saveCampaignOverride(CTX, C1, { concurrent_calls: 9999 }, null)).toEqual({ ok: false, error: "invalid" });
    expect(await saveCampaignOverride(CTX, C1, { holidays: [] }, null)).toEqual({ ok: false, error: "invalid" });
    expect(h.jar.get(MOCK_COOKIE)).toBeUndefined();
  });
  it("an empty override removes the campaign's entry", async () => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "mock");
    await saveCampaignOverride(CTX, C1, { concurrent_calls: 3 }, null);
    await saveCampaignOverride(CTX, C1, {}, null);
    expect(JSON.parse(h.jar.get(MOCK_COOKIE) ?? "{}")).toEqual({});
  });
});

describe("a campaign's call settings, from the API (CALL_SETTINGS_SCREENS=1)", () => {
  beforeEach(() => {
    vi.stubEnv("CALL_SETTINGS_SCREENS", "1");
    h.ws.mockReset();
    h.ws.mockResolvedValue({ settings: base, lockedPurposes: null, saved: true });
  });

  it("reads the contract's effective settings and the names of the fields the campaign changed; unknown names are dropped", () => {
    const got = parseCampaignCalls({ effective: { settings: { ...base, concurrent_calls: 3 }, overridden: ["concurrent_calls", "nonsense", 4] }, saved: true });
    expect(got.overridden).toEqual(["concurrent_calls"]);
    expect(got.effective.concurrent_calls).toBe(3);
    expect(() => parseCampaignCalls({ effective: {} })).toThrow();
  });
  it("shows what the API says, and 'unavailable' (never made-up settings) when the campaign's read fails", async () => {
    h.get.mockResolvedValueOnce({ effective: { ...base, concurrent_calls: 3 }, overridden: ["concurrent_calls"], saved: true });
    expect(await readCampaignCalls(CTX, C1, null)).toMatchObject({ mode: "ok", overridden: ["concurrent_calls"] });
    h.get.mockRejectedValueOnce(new Error("down"));
    expect(await readCampaignCalls(CTX, C1, null)).toEqual({ mode: "unavailable" });
  });
  it("sends only the difference, and maps the API's refusals: second factor, locked business type, read-only workspace, invalid, anything else", async () => {
    h.put.mockResolvedValueOnce(undefined);
    expect(await saveCampaignOverride(CTX, C1, { concurrent_calls: 2 }, null)).toEqual({ ok: true });
    expect(h.put).toHaveBeenCalledWith("tok", CTX.tenantId, C1, { concurrent_calls: 2 });
    const refuse = async (status: number, code: string) => {
      h.put.mockRejectedValueOnce(new ApiRequestError(status, code, "x"));
      return saveCampaignOverride(CTX, C1, { concurrent_calls: 2 }, null);
    };
    expect(await refuse(403, "mfa_required")).toEqual({ ok: false, error: "mfa" });
    expect(await refuse(409, "locked_for_business_type")).toEqual({ ok: false, error: "locked" });
    expect(await refuse(409, "workspace_read_only")).toEqual({ ok: false, error: "read_only" });
    expect(await refuse(422, "validation_error")).toEqual({ ok: false, error: "invalid" });
    expect(await refuse(500, "boom")).toEqual({ ok: false, error: "not_available" });
    h.put.mockRejectedValueOnce(new Error("network"));
    expect(await saveCampaignOverride(CTX, C1, { concurrent_calls: 2 }, null)).toEqual({ ok: false, error: "not_available" });
  });
  it("clearing posts the clear and maps the same refusals", async () => {
    h.clear.mockResolvedValueOnce(undefined);
    expect(await clearCampaign(CTX, C1)).toEqual({ ok: true });
    h.clear.mockRejectedValueOnce(new ApiRequestError(403, "mfa_required", "x"));
    expect(await clearCampaign(CTX, C1)).toEqual({ ok: false, error: "mfa" });
    h.clear.mockRejectedValueOnce(new ApiRequestError(409, "workspace_read_only", "x"));
    expect(await clearCampaign(CTX, C1)).toEqual({ ok: false, error: "read_only" });
  });
});
