import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(k) : jar.set(k, v)), delete: (k: string) => jar.delete(k) }) }));

import { ApiAuthError, ApiContractError, ApiRequestError } from "@/lib/api/client";
import { getTakeOver, putTakeOver } from "@/lib/api/take-over";

import { changeTakeOver, readTakeOver } from "./source";
import { parseTakeOver } from "./types";

const T = "66666666-6666-4666-8666-666666666666";
const CTX = { token: "tok", tenantId: T };
const API = { enabled: true, updated_at: "2026-11-10T10:00:00Z", announces: false };
beforeEach(() => {
  jar.clear();
  request.mockReset();
  vi.unstubAllEnvs();
});

describe("the switch as the API sends it", () => {
  it("reads the state, when it changed and whether the caller is told; refuses what is not a switch", () => {
    expect(parseTakeOver(API)).toEqual({ enabled: true, changedAt: "2026-11-10T10:00:00Z", announces: false });
    expect(parseTakeOver({ enabled: false, updated_at: null, announces: true })).toEqual({ enabled: false, changedAt: null, announces: true });
    expect(parseTakeOver({ ...API, enabled: "yes" })).toBeNull();
    expect(parseTakeOver({ ...API, enabled: 1 })).toBeNull();
    expect(parseTakeOver(null)).toBeNull();
    expect(parseTakeOver([])).toBeNull();
    expect(parseTakeOver({ enabled: false, announces: "yes" })).toMatchObject({ announces: false });
  });
  it("goes to the workspace's own setting; PUT sends only the yes or no; a bad answer is a contract error", async () => {
    request.mockResolvedValue(API);
    expect((await getTakeOver("tok", T)).enabled).toBe(true);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/calls/take-over-setting`, "tok");
    await putTakeOver("tok", T, false);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/calls/take-over-setting`, "tok", { method: "PUT", body: JSON.stringify({ enabled: false }) });
    request.mockResolvedValue({});
    await expect(getTakeOver("tok", T)).rejects.toBeInstanceOf(ApiContractError);
    await expect(getTakeOver("tok", "x")).rejects.toBeInstanceOf(ApiContractError);
  });
});

describe("reading and changing it", () => {
  it("is not there with the call screens off", async () => {
    expect(await readTakeOver(CTX)).toEqual({ mode: "off" });
    expect(await changeTakeOver(CTX, true)).toEqual({ ok: false, error: "not_available" });
    expect(request).not.toHaveBeenCalled();
  });
  it("live: shows what the API says; refusals become closed words; only a real yes or no is sent; a lapsed sign-in is let through", async () => {
    vi.stubEnv("CALL_SCREENS", "1");
    request.mockResolvedValue(API);
    expect(await readTakeOver(CTX)).toMatchObject({ mode: "ok", data: { enabled: true } });
    request.mockRejectedValue(new Error("down"));
    expect(await readTakeOver(CTX)).toEqual({ mode: "unavailable" });
    for (const [err, word] of [[new ApiRequestError(403, "forbidden", "x"), "forbidden"], [new ApiRequestError(503, "calls_unavailable", "x"), "not_available"], [new ApiRequestError(500, "internal_error", "x"), "down"], [new Error("boom"), "down"]] as const) {
      request.mockRejectedValue(err);
      expect(await changeTakeOver(CTX, true)).toEqual({ ok: false, error: word });
    }
    request.mockClear();
    for (const bad of ["yes", 1, null, undefined, {}]) expect(await changeTakeOver(CTX, bad)).toEqual({ ok: false, error: "down" });
    expect(request).not.toHaveBeenCalled();
    const out = new ApiAuthError("out");
    request.mockImplementation(() => Promise.reject(out));
    let caught: unknown = null;
    try {
      await changeTakeOver(CTX, true);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(out);
  });
  it("mock: the switch is OFF at first, kept in a cookie and shown back", async () => {
    vi.stubEnv("CALL_SCREENS", "mock");
    expect(await readTakeOver(CTX)).toMatchObject({ mode: "ok", data: { enabled: false, announces: false } });
    expect(await changeTakeOver(CTX, true)).toMatchObject({ ok: true, data: { enabled: true } });
    expect(await readTakeOver(CTX)).toMatchObject({ data: { enabled: true } });
    await changeTakeOver(CTX, false);
    expect(await readTakeOver(CTX)).toMatchObject({ data: { enabled: false } });
  });
});
