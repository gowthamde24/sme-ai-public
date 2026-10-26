import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (h.jar.has(k) ? { name: k, value: h.jar.get(k) } : undefined), set: (k: string, v: string) => void h.jar.set(k, v) }) }));

import { MOCK_COOKIE, encodeCorrections, mockOutcomes, mockTotals, parseCorrections } from "./mock";
import { correctOutcome, readCustomerOutcomes, readOutcomeTotals } from "./source";
import { CATEGORIES, CATEGORIES_OF, RESULTS } from "./types";

const ctx = { token: "t", tenantId: "t1" };
const NOW = new Date("2026-10-25T12:00:00Z");
beforeEach(() => {
  h.jar.clear();
  vi.unstubAllEnvs();
});

describe("what happened after a call or a follow-up (fake data)", () => {
  it("every result has categories that go with it, and every category belongs to exactly one result", () => {
    expect(RESULTS).toEqual(["positive", "negative", "unclear"]);
    expect([...RESULTS.flatMap((r) => CATEGORIES_OF[r])].sort()).toEqual([...CATEGORIES].sort());
  });
  it("is the same for the same customer, newest first, with a reason of words and no name or number", () => {
    const a = mockOutcomes("lead-1", NOW);
    expect(mockOutcomes("lead-1", NOW)).toEqual(a);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.map((o) => Date.parse(o.at))).toEqual([...a.map((o) => Date.parse(o.at))].sort((x, y) => y - x));
    for (const o of a) {
      expect(CATEGORIES_OF[o.result]).toContain(o.category);
      expect(o.reason).not.toMatch(/\d{6,}|@/);
    }
  });
  it("lays the owner's corrections over them and says so", () => {
    const [first] = mockOutcomes("lead-1", NOW);
    const [fixed] = mockOutcomes("lead-1", NOW, { [first.id]: ["negative", "too_costly"] });
    expect(fixed).toMatchObject({ id: first.id, result: "negative", category: "too_costly", corrected: true });
    expect(first.corrected).toBe(false);
  });
  it("reads corrections with allow-lists: a wrong shape, a category that does not go with the result or too many are dropped", () => {
    expect(parseCorrections(undefined)).toEqual({});
    expect(parseCorrections("not json")).toEqual({});
    expect(parseCorrections("[1,2]")).toEqual({});
    expect(parseCorrections(JSON.stringify({ a1: ["positive", "visit_booked"], bad: ["positive", "too_costly"], "<x>": ["positive", "interested"], c: ["maybe", "interested"] }))).toEqual({ a1: ["positive", "visit_booked"] });
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`id${i}`, ["positive", "interested"]]));
    expect(Object.keys(parseCorrections(JSON.stringify(many)))).toHaveLength(12);
    expect(parseCorrections(encodeCorrections({ q1: ["unclear", "call_back_later"] }))).toEqual({ q1: ["unclear", "call_back_later"] });
  });
  it("totals are counts only", () => {
    expect(Object.keys(mockTotals()).sort()).toEqual(["negative", "notInterested", "positive", "unclear"]);
  });
});

describe("where the screens read outcomes from, by the flag", () => {
  it("off (the default): nothing is read and nothing is drawn", async () => {
    expect(await readCustomerOutcomes(ctx, "lead-1")).toEqual({ mode: "off" });
    expect(await readOutcomeTotals(ctx)).toEqual({ mode: "off" });
    expect(await correctOutcome(ctx, "m1-0", "negative", "too_costly")).toEqual({ ok: false, error: "not_available" });
    expect(h.jar.size).toBe(0);
  });
  it("on: C1's API is not published yet, so the parts say 'Not available yet' and nothing is changed", async () => {
    vi.stubEnv("OUTCOME_SCREENS", "1");
    expect(await readCustomerOutcomes(ctx, "lead-1")).toEqual({ mode: "unavailable" });
    expect(await readOutcomeTotals(ctx)).toEqual({ mode: "unavailable" });
    expect(await correctOutcome(ctx, "m1-0", "negative", "too_costly")).toEqual({ ok: false, error: "not_available" });
  });
  it("mock: the invented outcomes, and a correction is kept in the cookie and read back", async () => {
    vi.stubEnv("OUTCOME_SCREENS", "mock");
    const read = await readCustomerOutcomes(ctx, "lead-1", NOW);
    expect(read.mode).toBe("ok");
    const first = read.mode === "ok" ? read.data[0] : null;
    expect(first).not.toBeNull();
    expect(await correctOutcome(ctx, first!.id, "negative", "not_interested")).toEqual({ ok: true });
    const again = await readCustomerOutcomes(ctx, "lead-1", NOW);
    expect(again.mode === "ok" ? again.data[0] : null).toMatchObject({ result: "negative", category: "not_interested", corrected: true });
    expect(h.jar.get(MOCK_COOKIE)).toContain(first!.id);
  });
  it("mock: a correction that does not make sense, or an id that is not an id, is refused", async () => {
    vi.stubEnv("OUTCOME_SCREENS", "mock");
    expect(await correctOutcome(ctx, "m1-0", "positive", "too_costly")).toEqual({ ok: false, error: "invalid" });
    expect(await correctOutcome(ctx, "../x", "positive", "interested")).toEqual({ ok: false, error: "invalid" });
    expect(await correctOutcome(ctx, "m1-0", "great", "interested")).toEqual({ ok: false, error: "invalid" });
    expect(h.jar.size).toBe(0);
  });
});
