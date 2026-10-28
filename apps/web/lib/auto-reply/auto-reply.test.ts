import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? void jar.delete(k) : void jar.set(k, v)) }) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { getAutoReply, putAutoReply } from "@/lib/api/auto-reply";

import { changeAutoReply, readAutoReply } from "./source";
import { parseAutoReply } from "./types";

const T = "66666666-6666-4666-8666-666666666666";
const CTX = { token: "tok", tenantId: T };
const API = { enabled: true, changed_at: "2026-10-28T10:00:00Z", answered_today: 7, held_today: 2, daily_limit: 200, rules: ["answers_within_24_hours", "asks_you_before_prices_and_promises", "weird_rule"] };
beforeEach(() => {
  jar.clear();
  request.mockReset();
  vi.unstubAllEnvs();
});

describe("the switch as the API sends it", () => {
  it("reads the state and the counts, keeps only the rules it has words for, and refuses what is not a switch", () => {
    expect(parseAutoReply(API)).toEqual({ enabled: true, changedAt: "2026-10-28T10:00:00Z", answeredToday: 7, heldToday: 2, dailyLimit: 200, rules: ["answers_within_24_hours", "asks_you_before_prices_and_promises"] });
    expect(parseAutoReply({ ...API, enabled: "yes" })).toBeNull();
    expect(parseAutoReply(null)).toBeNull();
    expect(parseAutoReply({ enabled: false, answered_today: -3 })).toMatchObject({ answeredToday: 0, rules: [] });
  });
  it("goes to the workspace's own switch; PUT sends only the yes or no; a bad answer is a contract error", async () => {
    request.mockResolvedValue(API);
    expect((await getAutoReply("tok", T)).enabled).toBe(true);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant/auto-reply`, "tok");
    await putAutoReply("tok", T, false);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/ai-assistant/auto-reply`, "tok", { method: "PUT", body: JSON.stringify({ enabled: false }) });
    request.mockResolvedValue({});
    await expect(getAutoReply("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(getAutoReply("tok", "x")).rejects.toBeInstanceOf(ApiContractError);
  });
});

describe("reading and changing it", () => {
  it("is not there with the flag off", async () => {
    expect(await readAutoReply(CTX)).toEqual({ mode: "off" });
    expect(await changeAutoReply(CTX, true)).toEqual({ ok: false, error: "not_available" });
  });
  it("live: shows what the API says; refusals become closed words (the second factor, forbidden, not available, down); a lapsed sign-in is let through", async () => {
    vi.stubEnv("AUTO_REPLY_SCREENS", "1");
    request.mockResolvedValue(API);
    expect(await readAutoReply(CTX)).toMatchObject({ mode: "ok", data: { enabled: true } });
    request.mockRejectedValue(new Error("down"));
    expect(await readAutoReply(CTX)).toEqual({ mode: "unavailable" });
    for (const [err, word] of [[new ApiRequestError(403, "mfa_required", "x"), "mfa"], [new ApiRequestError(503, "auto_reply_unavailable", "x"), "not_available"], [new ApiRequestError(403, "forbidden", "x"), "forbidden"], [new ApiRequestError(500, "x", "x"), "down"]] as const) {
      request.mockRejectedValue(err);
      expect(await changeAutoReply(CTX, true)).toEqual({ ok: false, error: word });
    }
    expect(await changeAutoReply(CTX, "yes")).toEqual({ ok: false, error: "down" });
    const out = new ApiAuthError("out");
    request.mockImplementation(() => Promise.reject(out));
    let caught: unknown = null;
    try {
      await changeAutoReply(CTX, true);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(out);
  });
  it("mock: the switch is kept in a cookie and shown back", async () => {
    vi.stubEnv("AUTO_REPLY_SCREENS", "mock");
    expect(await readAutoReply(CTX)).toMatchObject({ mode: "ok", data: { enabled: false } });
    expect(await changeAutoReply(CTX, true)).toMatchObject({ ok: true, data: { enabled: true, answeredToday: 7 } });
    expect(await readAutoReply(CTX)).toMatchObject({ data: { enabled: true } });
    await changeAutoReply(CTX, false);
    expect(await readAutoReply(CTX)).toMatchObject({ data: { enabled: false } });
  });
});
