import { describe, expect, it } from "vitest";

import { EMPTY, FAKE_CALL_PAISE_PER_MINUTE, MINUTES_PER_CALL, SECONDS_PER_PERSON, answerOf, handoffsOf, itemsOf, newBatch, newRule, parse, planHash, planOf, progressOf, reportOf, ruleOf, seedOf } from "./mock";
import type { BatchInput } from "./types";

const input: BatchInput = { batchId: "22222222-2222-4222-8222-222222222222", name: "Test", goal: "general", channel: "call", language: "en", who: { kind: "source", source: "indiamart", status: "new", since: null }, questions: ["Q?"], messageText: null, windowDays: 7, maxCallsPerDay: null, maxTotalMinutes: null };
const t0 = new Date("2026-10-27T10:00:00.000Z");

describe("the fake of the speed-to-lead screens", () => {
  it("makes the same plan from the same batch every time, with the estimate worked out by the fake rates", () => {
    const b = newBatch(input, t0);
    expect(planOf(b)).toEqual(planOf(b));
    const p = planOf(b);
    expect(p.estimatedMinutes).toBe(p.ready * MINUTES_PER_CALL);
    expect(p.estimatedCostPaise).toBe(p.estimatedMinutes * FAKE_CALL_PAISE_PER_MINUTE);
    expect(p.estimatedMessages).toBe(0);
    expect(p.ready + Object.values(p.skipped).reduce((a, n) => a + n, 0)).toBe(p.count);
    expect(planOf({ ...b, channel: "whatsapp" }).estimatedMinutes).toBe(0);
  });
  it("leaving someone out changes the plan and its hash; the same exclusions give the same hash", () => {
    const b = newBatch(input, t0);
    const out = { ...b, excluded: [planOf(b).sample[0].contactId] };
    expect(planOf(out).ready).toBe(planOf(b).ready - 1);
    expect(planHash(out)).not.toBe(planHash(b));
    expect(planHash({ ...out, excluded: [...out.excluded] })).toBe(planHash(out));
  });
  it("runs one person every three seconds after the approval, and is done when everybody was reached", () => {
    const b = { ...newBatch(input, t0), approvedAt: t0.toISOString() };
    const ready = planOf(b).ready;
    expect(progressOf(newBatch(input, t0), t0)).toBeNull();
    expect(progressOf(b, new Date(t0.getTime() + 9_000))?.done).toBe(3);
    expect(answerOf(b, new Date(t0.getTime() + 9_000)).batch.status).toBe("running");
    const late = new Date(t0.getTime() + (ready + 5) * SECONDS_PER_PERSON * 1000);
    expect(progressOf(b, late)?.done).toBe(ready);
    expect(answerOf(b, late).batch.status).toBe("done");
    expect(answerOf({ ...b, paused: true }, t0).batch.status).toBe("paused");
    expect(answerOf({ ...b, cancelled: true }, t0).batch.status).toBe("cancelled");
  });
  it("reads people back with the reason they are left out", () => {
    const b = newBatch(input, t0);
    const first = planOf(b).sample[0].contactId;
    const items = itemsOf({ ...b, excluded: [first] }, t0);
    expect(items.find((i) => i.contactId === first)).toMatchObject({ status: "skipped", reason: "excluded" });
    expect(items.every((i) => i.status === "skipped" || i.status === "planned")).toBe(true);
  });
  it("reads the cookie with every part checked and drops what is not right", () => {
    expect(parse(null)).toBeNull();
    expect(parse({ batches: "x" })).toEqual({ batches: [], rules: [], acted: [] });
    const b = newBatch(input, t0);
    expect(parse({ batches: [b, { ...b, goal: "nope" }, { ...b, id: "bad" }], rules: [], acted: ["x"] })?.batches).toHaveLength(1);
    const r = newRule({ ruleId: "33333333-3333-4333-8333-333333333333", source: "indiamart", action: "call_within_minutes", withinMinutes: 2, goal: "general", channel: "call", language: "en", questions: [], messageText: null, maxCallsPerDay: 50, maxTotalMinutes: null }, t0);
    expect(parse({ ...EMPTY, rules: [r, { ...r, source: "tv" }, { ...r, withinMinutes: 500 }] })?.rules.map((x) => x.withinMinutes)).toEqual([2, 120]);
    expect(ruleOf(r, new Date(t0.getTime() + 3 * 86_400_000)).usage.leads).toBeGreaterThanOrEqual(3);
  });
  it("lists two hot leads that go away when they are marked, and a made-up report whose totals add up", () => {
    const user = "44444444-4444-4444-8444-444444444444";
    expect(handoffsOf(EMPTY, user, t0, true)).toHaveLength(2);
    const marked = { ...EMPTY, acted: ["00000000-0000-4000-8000-0000000000a1"] };
    expect(handoffsOf(marked, user, t0, true)).toHaveLength(1);
    expect(handoffsOf(marked, user, t0, false)).toHaveLength(2);
    const r = reportOf("2026-10-20", "2026-10-26");
    expect(r.total.leads).toBe(r.bySource.reduce((a, x) => a + x.leads, 0));
    expect(r.total.bookings).toBe(r.bySource.reduce((a, x) => a + x.bookings, 0));
    expect(seedOf("a")).toBe(seedOf("a"));
  });
});
