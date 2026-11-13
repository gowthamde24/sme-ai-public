import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { value: jar.get(n) } : undefined), set: (n: string, v: string, o?: { maxAge?: number }) => (o?.maxAge === 0 ? jar.delete(n) : jar.set(n, v)) }),
}));

import { COOKIE, approveStep, readPhone, releaseNumber, requestNumber } from "./source";
import { MOCK_NUMBER, NOTHING, parsePhone } from "./types";

beforeEach(() => {
  jar.clear();
  vi.stubEnv("PHONE_NUMBER_SCREENS", "mock");
});

describe("the made-up numbers", () => {
  it("are all +00 numbers, one per city, never a real one", () => {
    for (const n of Object.values(MOCK_NUMBER)) expect(n).toMatch(/^\+00 /);
    expect(new Set(Object.values(MOCK_NUMBER)).size).toBe(4);
  });
});

describe("parsePhone: the cookie is never trusted", () => {
  it.each([[null], ["x"], [[]], [{ state: "active", city: "hyderabad", done: ["business_proof"] }], [{ state: "kyc_pending", city: "delhi", done: [] }], [{ state: "weird" }], [{ state: "kyc_pending", city: "chennai", done: "all" }]])("%j is refused", (v) => {
    expect(parsePhone(v)).toBeNull();
  });
  it("takes the number from the city, never from the cookie, and drops unknown steps", () => {
    expect(parsePhone({ state: "kyc_pending", city: "chennai", number: "+91 98765 43210", done: ["owner_id", "nope"] })).toEqual({ state: "kyc_pending", city: "chennai", number: MOCK_NUMBER.chennai, done: ["owner_id"] });
  });
});

describe("the flag", () => {
  it("off: the part is not there; on (the API that does not exist yet): not available; mock: a state", async () => {
    vi.stubEnv("PHONE_NUMBER_SCREENS", "");
    expect(await readPhone()).toEqual({ mode: "off" });
    vi.stubEnv("PHONE_NUMBER_SCREENS", "1");
    expect(await readPhone()).toEqual({ mode: "unavailable" });
    expect(await requestNumber("hyderabad")).toEqual({ ok: false, error: "not_available" });
    vi.stubEnv("PHONE_NUMBER_SCREENS", "mock");
    expect(await readPhone()).toEqual({ mode: "ok", data: NOTHING, mock: true });
  });
});

describe("the steps", () => {
  it("pick a city -> reserved and waiting -> every step approved -> active -> given back", async () => {
    expect(await requestNumber("mumbai")).toEqual({ ok: true, data: { state: "kyc_pending", city: "mumbai", number: MOCK_NUMBER.mumbai, done: [] } });
    expect(await approveStep("owner_id")).toMatchObject({ ok: true, data: { state: "kyc_pending", done: ["owner_id"] } });
    expect(await approveStep("owner_id")).toMatchObject({ ok: true, data: { state: "kyc_pending", done: ["owner_id"] } }); // twice is the same
    expect(await approveStep("business_proof")).toMatchObject({ ok: true, data: { state: "active", done: ["business_proof", "owner_id"] } });
    expect(JSON.parse(jar.get(COOKIE) ?? "{}").state).toBe("active");
    expect(await releaseNumber()).toEqual({ ok: true, data: NOTHING });
    expect(jar.has(COOKIE)).toBe(false);
  });

  it("refuses a bad city, a bad step, and a move from the wrong state", async () => {
    expect(await requestNumber("delhi")).toEqual({ ok: false, error: "invalid" });
    expect(await approveStep("owner_id")).toEqual({ ok: false, error: "state" }); // nothing reserved
    await requestNumber("chennai");
    expect(await requestNumber("mumbai")).toEqual({ ok: false, error: "state" }); // already has one
    expect(await approveStep("passport")).toEqual({ ok: false, error: "invalid" });
  });
});
