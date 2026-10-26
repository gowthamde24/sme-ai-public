import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: (n: string, v: string) => jar.set(n, v), delete: (n: string) => jar.delete(n) }) }));
const putMarketingConsent = vi.fn();
const getMyConsents = vi.fn();
const postGrievance = vi.fn();
vi.mock("@/lib/api/dpdp", () => ({ putMarketingConsent: (...a: unknown[]) => putMarketingConsent(...a), getMyConsents: (...a: unknown[]) => getMyConsents(...a), postGrievance: (...a: unknown[]) => postGrievance(...a) }));

import { MOCK_COOKIE, parse, setMarketing, toConsents } from "./mock";
import { changeMarketing, raiseGrievance, readConsents } from "./source";

beforeEach(() => {
  jar.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());
const NOW = new Date("2026-10-27T06:00:00Z");

describe("the fake consent record (DPDP_SCREENS=mock)", () => {
  it("starts not given; giving then withdrawing leaves two rows, newest first; the same state again leaves none", () => {
    let v = parse(undefined);
    expect(toConsents(v).marketing).toEqual({ state: "not_given", since: null });
    v = setMarketing(v, true, "signup", NOW);
    expect(toConsents(v).marketing).toEqual({ state: "given", since: NOW.toISOString() });
    expect(setMarketing(v, true, "settings", new Date(NOW.getTime() + 1000))).toBe(v); // nothing new
    v = setMarketing(v, false, "settings", new Date(NOW.getTime() + 2000));
    expect(toConsents(v).history.map((h) => [h.action, h.via])).toEqual([["withdrawn", "settings"], ["given", "signup"]]);
    expect(setMarketing(parse(undefined), false, "settings", NOW).s).toBe("not_given"); // withdrawing what was never given records nothing
  });
  it("a cookie that is not ours reads as not given", () => {
    for (const raw of ["{broken", JSON.stringify({ s: "maybe", h: [] }), JSON.stringify({ s: "given" })]) expect(parse(raw).s).toBe("not_given");
  });
});

describe("the source: off, mock or the API", () => {
  it("mock keeps the choice in a cookie and calls no API", async () => {
    vi.stubEnv("DPDP_SCREENS", "mock");
    expect((await readConsents("t"))?.marketing.state).toBe("not_given");
    const out = await changeMarketing("t", true, "settings");
    expect(out.ok && out.consents.marketing.state).toBe("given");
    expect(jar.has(MOCK_COOKIE)).toBe(true);
    expect((await readConsents("t"))?.marketing.state).toBe("given");
    expect(putMarketingConsent).not.toHaveBeenCalled();
    expect(await raiseGrievance({ name: "A", contact: "a@b.test", kind: "other", details: "", language: "en" }, NOW)).toMatchObject({ ok: true, reference: "GR-2026-000001", answerWithinDays: 30 });
    expect(postGrievance).not.toHaveBeenCalled();
  });
  it("on goes to the API with the person's token; a failed read is null ('Not available yet') and a failed change is 'down', never a success", async () => {
    vi.stubEnv("DPDP_SCREENS", "1");
    getMyConsents.mockResolvedValue({ noticeVersion: "v", marketing: { state: "given", since: null }, history: [] });
    expect((await readConsents("tok"))?.marketing.state).toBe("given");
    expect(getMyConsents).toHaveBeenCalledWith("tok");
    putMarketingConsent.mockResolvedValue({ noticeVersion: "v", marketing: { state: "withdrawn", since: null }, history: [] });
    expect(await changeMarketing("tok", false, "settings")).toMatchObject({ ok: true });
    expect(putMarketingConsent).toHaveBeenCalledWith("tok", false, "settings");
    getMyConsents.mockRejectedValue(new Error("x"));
    expect(await readConsents("tok")).toBeNull();
    putMarketingConsent.mockRejectedValue(new Error("x"));
    expect(await changeMarketing("tok", true)).toEqual({ ok: false, error: "down" });
    postGrievance.mockResolvedValue({ ok: false, error: "rate" });
    expect(await raiseGrievance({ name: "A", contact: "a@b.test", kind: "other", details: "", language: "en" })).toEqual({ ok: false, error: "rate" });
    expect(postGrievance.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/); // a fresh id makes a retry safe
  });
});
