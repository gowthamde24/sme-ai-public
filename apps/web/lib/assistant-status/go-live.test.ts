import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("@/lib/api/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/client")>()), apiRequest: (...a: unknown[]) => request(...a) }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined), set: (k: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(k) : jar.set(k, v)), delete: (k: string) => jar.delete(k) }) }));

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { MOCK_NUMBER, PHONE_COOKIE, connectMockPhone, goLive, hasOwnName, missingFor, pause, readMockPhone } from "./go-live";
import { CHOICE_COOKIE, readChoice, writeChoice } from "./setup-choice";
import { COOKIE, readAssistantStatus } from "./source";

const T = "66666666-6666-4666-8666-666666666666";
const API = { state: "live", can_go_live: true, missing: [], using_defaults: ["voice"] };
beforeEach(() => {
  jar.clear();
  request.mockReset();
  vi.unstubAllEnvs();
});

describe("a business name of its own", () => {
  it("is not the placeholder, not empty", () => {
    expect(hasOwnName("Sri Lakshmi Silks")).toBe(true);
    for (const n of ["My business", "  my BUSINESS ", "", "   ", null, undefined]) expect(hasOwnName(n)).toBe(false);
  });
});

describe("Go live and Pause, mock (staging)", () => {
  beforeEach(() => vi.stubEnv("ASSISTANT_STATUS", "mock"));
  it("needs the business name and a connected phone number, and nothing else", async () => {
    const status = await readAssistantStatus("tok", T);
    expect(await missingFor(status, "My business")).toEqual(["business_name", "phone_number"]);
    expect(await missingFor(status, "Sri Lakshmi Silks")).toEqual(["phone_number"]);
    await connectMockPhone();
    expect(await missingFor(status, "Sri Lakshmi Silks")).toEqual([]);
    expect(await missingFor(status, "")).toEqual(["business_name"]);
    expect(await missingFor(null, "x")).toBeNull();
  });
  it("refuses to go live without them, and says what is missing; the state does not change", async () => {
    expect(await goLive("tok", T, "Sri Lakshmi Silks")).toEqual({ ok: false, error: "missing", missing: ["phone_number"] });
    expect(jar.has(COOKIE)).toBe(false);
  });
  it("goes live with defaults once both are there, and pause takes it back", async () => {
    await connectMockPhone();
    const out = await goLive("tok", T, "Sri Lakshmi Silks");
    expect(out).toMatchObject({ ok: true, status: { state: "live" } });
    expect(jar.get(COOKIE)).toBe("live");
    expect((await readAssistantStatus("tok", T))?.state).toBe("live");
    expect(await pause("tok", T)).toMatchObject({ ok: true, status: { state: "not_live" } });
    expect(jar.get(COOKIE)).toBe("not_live");
    expect(request).not.toHaveBeenCalled(); // nothing goes to the network
  });
  it("the made-up number is only the one the mock sets", async () => {
    expect(await readMockPhone()).toBeNull();
    jar.set(PHONE_COOKIE, "+91 98765 43210");
    expect(await readMockPhone()).toBeNull();
    await connectMockPhone();
    expect(await readMockPhone()).toBe(MOCK_NUMBER);
  });
  it("cannot connect a test number where the status is not a mock", async () => {
    vi.stubEnv("ASSISTANT_STATUS", "1");
    expect(await connectMockPhone()).toBe(false);
    expect(jar.has(PHONE_COOKIE)).toBe(false);
  });
});

describe("Go live and Pause, the API (C1: POST /assistant/go-live, /pause)", () => {
  beforeEach(() => vi.stubEnv("ASSISTANT_STATUS", "1"));
  it("posts to the workspace's own route and returns the status", async () => {
    request.mockResolvedValue(API);
    expect(await goLive("tok", T, "x")).toMatchObject({ ok: true, status: { state: "live", canGoLive: true } });
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/go-live`, "tok", { method: "POST" });
    await pause("tok", T);
    expect(request).toHaveBeenLastCalledWith(`/v1/tenants/${T}/assistant/pause`, "tok", { method: "POST" });
  });
  it("a 409 assistant_not_ready is answered with what the status says is missing", async () => {
    request.mockRejectedValueOnce(new ApiRequestError(409, "assistant_not_ready", "x"));
    request.mockResolvedValueOnce({ state: "not_live", can_go_live: false, missing: ["phone_number"], using_defaults: [] });
    expect(await goLive("tok", T, "x")).toEqual({ ok: false, error: "missing", missing: ["phone_number"] });
  });
  it("other refusals are closed words; a lapsed sign-in is let through; an odd answer is 'down'", async () => {
    for (const [err, word] of [[new ApiRequestError(403, "forbidden", "x"), "forbidden"], [new ApiRequestError(404, "not_found", "x"), "not_available"], [new ApiRequestError(500, "internal_error", "x"), "down"], [new Error("boom"), "down"]] as const) {
      request.mockRejectedValueOnce(err);
      expect(await goLive("tok", T, "x")).toMatchObject({ ok: false, error: word });
    }
    request.mockRejectedValueOnce(new ApiAuthError());
    await expect(goLive("tok", T, "x")).rejects.toBeInstanceOf(ApiAuthError);
    request.mockResolvedValueOnce({ nonsense: true });
    expect(await goLive("tok", T, "x")).toMatchObject({ ok: false, error: "down" });
  });
  it("is not there with the flag off, or for a workspace id that is not one", async () => {
    vi.stubEnv("ASSISTANT_STATUS", "");
    expect(await goLive("tok", T, "x")).toMatchObject({ ok: false, error: "not_available" });
    vi.stubEnv("ASSISTANT_STATUS", "1");
    expect(await goLive("tok", "not-an-id", "x")).toMatchObject({ ok: false, error: "not_available" });
    expect(request).not.toHaveBeenCalled();
  });
  it("the API's own list is what is missing (no mock rules)", async () => {
    expect(await missingFor({ state: "not_live", canGoLive: false, missing: ["business_name"], usingDefaults: [] }, "Sri Lakshmi Silks")).toEqual(["business_name"]);
  });
});

describe("what the person chose about the checklist (a cookie, per workspace)", () => {
  const OTHER = "77777777-7777-4777-8777-777777777777";
  it("is open until they choose; skipped and dismissed are kept for that workspace only", async () => {
    expect(await readChoice(T)).toBe("open");
    expect(await writeChoice(T, "skipped")).toBe(true);
    expect(await readChoice(T)).toBe("skipped");
    expect(await readChoice(OTHER)).toBe("open");
    await writeChoice(T, "dismissed");
    expect(await readChoice(T)).toBe("dismissed");
  });
  it("ignores a cookie that is not what we wrote", async () => {
    jar.set(CHOICE_COOKIE, "not json");
    expect(await readChoice(T)).toBe("open");
    jar.set(CHOICE_COOKIE, JSON.stringify({ [T]: "banana", "bad key": "skipped" }));
    expect(await readChoice(T)).toBe("open");
  });
  it("keeps at most eight workspaces", async () => {
    for (let i = 0; i < 10; i++) await writeChoice(`0000000${i}-0000-4000-8000-000000000000`, "skipped");
    expect(Object.keys(JSON.parse(jar.get(CHOICE_COOKIE) ?? "{}"))).toHaveLength(8);
  });
});
