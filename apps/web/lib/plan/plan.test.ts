import { describe, expect, it } from "vitest";

import { CATALOGUE, callsPlans, mainPlans, planById } from "./catalogue";
import { planScreens } from "./flag";
import { NOTICE_AT, PAUSE_AT, meterState, percent, remaining, trialDay, trialDaysLeft } from "./meters";
import { FRESH, cancel, encodeMock, endTrial, fixPayment, parseMock, startTrial, toWorkspacePlan } from "./mock";

describe("the plans as data", () => {
  it("are the six of C1's plans file (job DI), and NO price is invented: every price is null until the owner sets it", () => {
    expect(mainPlans().map((p) => p.name)).toEqual(["Starter", "Growth", "Business"]);
    expect(callsPlans().map((p) => p.name)).toEqual(["Pay-as-you-go", "Calls 300", "Calls 1,000"]);
    for (const p of CATALOGUE.plans) expect(p.priceInr, p.id).toBeNull();
  });
  it("carry the allowances of C1's plans file: trial 30 min and 100 messages for 14 days (counted from the day WhatsApp is connected); Starter 0/300, Growth 100/1,000, Business 300/3,000; Calls 300 and 1,000 minutes; team 1/3/10 and workspaces 1/1/3", () => {
    expect(CATALOGUE.trial).toEqual({ days: 14, callMinutes: 30, messages: 100, graceDays: 7 });
    expect(mainPlans().map((p) => [p.callMinutes, p.messages, p.users, p.workspaces])).toEqual([[0, 300, 1, 1], [100, 1000, 3, 1], [300, 3000, 10, 3]]);
    expect(callsPlans().map((p) => p.callMinutes)).toEqual([null, 300, 1000]);
    expect(callsPlans().map((p) => p.messages)).toEqual([null, 300, 1000]);
    expect(planById("growth")?.name).toBe("Growth");
    expect(planById("nope")).toBeNull();
    expect(planById(null)).toBeNull();
  });
});

describe("the meters: one gentle notice at 80 %, a pause at 100 %", () => {
  it("states", () => {
    expect([NOTICE_AT, PAUSE_AT]).toEqual([80, 100]);
    expect(meterState({ used: 79, included: 100 })).toBe("ok");
    expect(meterState({ used: 80, included: 100 })).toBe("notice");
    expect(meterState({ used: 99, included: 100 })).toBe("notice");
    expect(meterState({ used: 100, included: 100 })).toBe("paused");
    expect(meterState({ used: 250, included: 100 })).toBe("paused");
    expect(meterState({ used: 0, included: 0 })).toBe("not_included");
    expect(meterState({ used: 12, included: null })).toBe("no_cap");
  });
  it("the percentage rounds down, stays between 0 and 100, and is null where there is no cap or nothing included", () => {
    expect(percent({ used: 79, included: 100 })).toBe(79);
    expect(percent({ used: 24, included: 30 })).toBe(80);
    expect(percent({ used: 29, included: 30 })).toBe(96); // 96.67 rounded down: a meter never says 100 before it is
    expect(percent({ used: 500, included: 100 })).toBe(100);
    expect(percent({ used: -5, included: 100 })).toBe(0);
    expect(percent({ used: 5, included: null })).toBeNull();
    expect(percent({ used: 5, included: 0 })).toBeNull();
    expect(remaining({ used: 120, included: 100 })).toBe(0);
    expect(remaining({ used: 40, included: 100 })).toBe(60);
    expect(remaining({ used: 40, included: null })).toBeNull();
  });
});

describe("the trial days", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  it("counts whole days up, never below zero, and the day of the trial for 'cancel before day 30'", () => {
    expect(trialDaysLeft("2026-11-24T10:00:00Z", now)).toBe(30);
    expect(trialDaysLeft("2026-10-25T12:00:00Z", now)).toBe(1); // two hours left is still one day
    expect(trialDaysLeft("2026-10-24T10:00:00Z", now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBe(0);
    expect(trialDaysLeft("not a date", now)).toBe(0);
    expect(trialDay("2026-11-24T10:00:00Z", now, 30)).toBe(1);
    expect(trialDay("2026-10-26T10:00:00Z", now, 30)).toBe(30);
    expect(trialDay("2026-10-24T10:00:00Z", now, 30)).toBe(30);
  });
});

describe("the flag: off unless asked", () => {
  it("only '1' and 'mock' switch the screens on", () => {
    expect(planScreens(undefined)).toBe("off");
    expect(planScreens("")).toBe("off");
    expect(planScreens("0")).toBe("off");
    expect(planScreens("true")).toBe("off");
    expect(planScreens("1")).toBe("on");
    expect(planScreens("mock")).toBe("mock");
  });
});

describe("the fake provider", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  it("starts the trial only WITH a payment method, and not twice", () => {
    expect(startTrial(FRESH, "growth", "none")).toEqual({ error: "no_payment_method" });
    expect(startTrial(FRESH, "growth", "")).toEqual({ error: "no_payment_method" });
    expect(startTrial(FRESH, "nope", "test_ok")).toEqual({ error: "invalid" });
    expect(startTrial(FRESH, "growth", "test_declined")).toEqual({ error: "declined" }); // the card is refused at once: no trial
    const ok = startTrial(FRESH, "growth", "test_ok");
    expect("next" in ok && ok.next).toMatchObject({ state: "trialing", plan: "growth", method: "test_ok", day: 1 });
    expect(startTrial((ok as { next: typeof FRESH }).next, "business", "test_ok")).toEqual({ error: "already" });
  });
  it("a trial is started ONCE per workspace: not again after it was cancelled, like the API", () => {
    const cancelled = cancel({ ...FRESH, state: "trialing", plan: "growth", method: "test_ok", day: 3 }) as { next: typeof FRESH };
    expect(startTrial(cancelled.next, "growth", "test_ok")).toEqual({ error: "already" });
    expect(toWorkspacePlan(cancelled.next, now).canStartTrial).toBe(false);
    expect(toWorkspacePlan(FRESH, now).canStartTrial).toBe(true);
  });
  it("a workspace with no plan has the trial's allowances, like the API's", () => {
    expect(toWorkspacePlan(FRESH, now).included).toEqual({ minutes: 30, messages: 100 });
  });
  it("a trial has the TRIAL allowances (30 min, 100 messages), not the plan's; 14 days left on day 1", () => {
    const w = toWorkspacePlan({ ...FRESH, state: "trialing", plan: "business", method: "test_ok", day: 1 }, now);
    expect(w.included).toEqual({ minutes: 30, messages: 100 });
    expect(trialDaysLeft(w.trialEndsAt, now)).toBe(14);
    expect(toWorkspacePlan({ ...FRESH, state: "trialing", plan: "business", method: "test_ok", day: 30 }, now).trialEndsAt).not.toBeNull();
  });
  it("cancelling inside the trial charges nothing and says so; cancelling a paid plan does not claim that", () => {
    const t = cancel({ ...FRESH, state: "trialing", plan: "growth", method: "test_ok", day: 12 });
    const w = toWorkspacePlan((t as { next: typeof FRESH }).next, now);
    expect(w).toMatchObject({ state: "cancelled", cancelledInTrial: true });
    const p = cancel({ ...FRESH, state: "active", plan: "growth", method: "test_ok" }) as { next: typeof FRESH };
    const paid = toWorkspacePlan(p.next, now);
    expect(paid).toMatchObject({ state: "active", cancelledInTrial: false, cancelAtPeriodEnd: true }); // runs to the end of the period it paid for
    expect(cancel(p.next)).toEqual({ error: "invalid" });
    expect(cancel(FRESH)).toEqual({ error: "invalid" });
  });
  it("a failed payment has a grace period, can be put right, and only then", () => {
    expect(toWorkspacePlan({ ...FRESH, state: "past_due", plan: "growth", method: "test_fails" }, now).graceUntil).toBe("2026-11-01T10:00:00.000Z");
    const due = { ...FRESH, state: "past_due" as const, plan: "growth", method: "test_fails" as const };
    expect(fixPayment(due)).toMatchObject({ next: { state: "active", method: "test_ok" } });
    expect(fixPayment(FRESH)).toEqual({ error: "invalid" });
  });
  it("the cookie is read with allow-lists and bounds: junk, a long number or an unknown plan give a safe state", () => {
    expect(parseMock(undefined)).toEqual(FRESH);
    expect(parseMock("drop table;;;;;")).toEqual(FRESH);
    expect(parseMock("trialing;<script>;test_ok;99;-1;1e9;1")).toEqual(FRESH);
    expect(parseMock("trialing;growth;test_ok;99;-1;1e9;1")).toMatchObject({ state: "trialing", plan: "growth", method: "test_ok", day: 1, minutes: 0, messages: 0 });
    expect(parseMock(encodeMock({ state: "active", plan: "growth", method: "test_ok", day: 5, minutes: 42, messages: 310, cancelled: false, readOnly: false }))).toMatchObject({ plan: "growth", minutes: 42, messages: 310 });
  });
});

describe("the fake provider's test move to day 30", () => {
  const trial = (method: "test_ok" | "test_fails") => ({ ...FRESH, state: "trialing" as const, plan: "growth", method, day: 3, minutes: 5, messages: 9 });
  it("a card that works makes the plan active and starts the new period's meters at zero", () => {
    expect(endTrial(trial("test_ok"))).toEqual({ next: expect.objectContaining({ state: "active", day: 14, minutes: 0, messages: 0 }) });
  });
  it("a card that fails leaves it past due", () => {
    expect(endTrial(trial("test_fails"))).toEqual({ next: expect.objectContaining({ state: "past_due" }) });
  });
  it("only a trial can be moved", () => {
    expect(endTrial(FRESH)).toEqual({ error: "invalid" });
    expect(endTrial({ ...trial("test_ok"), state: "active" })).toEqual({ error: "invalid" });
  });
});


describe("the fake provider's read-only workspace (the trial ended unpaid)", () => {
  it("the cookie's eighth field marks it; only a workspace that has had a plan can be read-only; a missing field is full access", () => {
    const m = parseMock("cancelled;growth;test_ok;30;0;0;0;1");
    expect(m).toMatchObject({ state: "cancelled", readOnly: true });
    expect(parseMock(encodeMock(m)).readOnly).toBe(true);
    expect(parseMock("trialing;growth;test_ok;3;0;0;0;1").readOnly).toBe(false);
    expect(parseMock("none;;none;1;0;0;0;1")).toEqual(FRESH);
    expect(parseMock("cancelled;growth;test_ok;30;0;0;0").readOnly).toBe(false);
  });
  it("draws as access read_only with the 90 days the data is kept, and cannot start another trial", () => {
    const w = toWorkspacePlan({ ...parseMock("cancelled;growth;test_ok;30;0;0;0;1") }, new Date("2026-10-25T06:00:00Z"));
    expect(w).toMatchObject({ access: "read_only", readOnlySince: "2026-10-25", deleteOn: "2027-01-23", dataDaysLeft: 90, canStartTrial: false });
    expect(toWorkspacePlan(FRESH, new Date("2026-10-25T06:00:00Z"))).toMatchObject({ access: "full", readOnlySince: null, deleteOn: null, dataDaysLeft: null });
  });
});
