import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { BillingOut } from "@contracts/billing";
import { describe, expect, it } from "vitest";

import { CHECKOUT_REF, parseBilling, parsePlans, toWorkspacePlan } from "./api";
import { CATALOGUE, DRAFT_PLANS, callsPlans, catalogueFrom, mainPlans } from "./catalogue";
import { meterState } from "./meters";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const meter = (kind: "call_minutes" | "whatsapp_messages", used: number, allowance: number | null, over: Record<string, unknown> = {}) => ({
  kind,
  unit: kind === "call_minutes" ? "minutes" : "messages",
  used,
  allowance,
  remaining: allowance === null ? null : Math.max(0, allowance - used),
  percent: allowance ? Math.min(100, Math.floor((used / allowance) * 100)) : null,
  state: "ok",
  included: true,
  topup: 0,
  ...over,
});
const trialPlan = DRAFT_PLANS.plans[0];
/** A BillingOut in the shape of docs/contracts/plans-billing.md (the examples of packages/contracts/billing.examples.json). */
const billing = (over: Record<string, unknown> = {}): BillingOut =>
  ({
    plan: trialPlan,
    subscription: null,
    period: { start: "2026-10-01", end: "2026-10-30", timezone: "Asia/Kolkata", days_left: 5 },
    usage: { call_minutes: meter("call_minutes", 4.5, 30), whatsapp_messages: meter("whatsapp_messages", 12, 100) },
    notices: [],
    can_start_trial: true,
    access: "full",
    read_only_since: null,
    delete_on: null,
    data_days_left: null,
    ...over,
  }) as unknown as BillingOut;
const sub = (over: Record<string, unknown> = {}) => ({ status: "trialing", plan_id: "growth", provider: "fake", trial_ends_at: "2026-11-12T10:00:00Z", current_period_end: null, cancel_at_period_end: false, grace_until: null, payment_method_on_file: true, ...over });

describe("the catalogue from the API", () => {
  it("turns GET /v1/plans into the screens' plans: sorted by `sort`, the trial plan out of the list, ids and prices as data", () => {
    const out = parsePlans({ ...DRAFT_PLANS, plans: [...DRAFT_PLANS.plans].reverse() });
    const cat = catalogueFrom(out);
    expect(cat.plans.map((p) => p.id)).toEqual(["starter", "growth", "business", "calls_payg", "calls_300", "calls_1000"]);
    expect(cat.trial).toEqual({ days: 30, callMinutes: 30, messages: 100, graceDays: 7 });
    expect(mainPlans(cat)).toHaveLength(3);
    expect(callsPlans(cat)).toHaveLength(3);
  });
  it("a price that is set is shown in rupees (paise / 100); a null price stays null", () => {
    const priced = { ...DRAFT_PLANS, plans: DRAFT_PLANS.plans.map((p) => (p.id === "growth" ? { ...p, price_paise_monthly: 99900, price_set: true } : p)) };
    const cat = catalogueFrom(parsePlans(priced));
    expect(cat.plans.find((p) => p.id === "growth")?.priceInr).toBe(999);
    expect(cat.plans.find((p) => p.id === "starter")?.priceInr).toBeNull();
  });
  it("refuses a body that is not the contracted shape", () => {
    expect(() => parsePlans(null)).toThrow();
    expect(() => parsePlans({ trial: { days: 30 }, plans: [] })).toThrow();
    expect(() => parsePlans({ ...DRAFT_PLANS, plans: [{ id: 3 }] })).toThrow();
  });
  it("the draft file is a copy of C1's packages/plans/plans.json (checked wherever that file exists)", () => {
    const theirs = path.join(ROOT, "packages/plans/plans.json");
    if (!existsSync(theirs)) return; // this branch does not carry job DI's files; the combined branch does
    expect(JSON.parse(readFileSync(path.join(ROOT, "apps/web/lib/plan/plans.draft.json"), "utf8"))).toEqual(JSON.parse(readFileSync(theirs, "utf8")));
  });
  it("every example payload of packages/contracts/billing.examples.json is read and drawn without a throw (wherever that file exists)", () => {
    const examples = path.join(ROOT, "packages/contracts/billing.examples.json");
    if (!existsSync(examples)) return;
    const all = JSON.parse(readFileSync(examples, "utf8")) as Record<string, unknown>;
    expect(catalogueFrom(parsePlans(all.plans)).plans.length).toBe(CATALOGUE.plans.length);
    for (const key of Object.keys(all).filter((k) => k.startsWith("billing_"))) expect(() => toWorkspacePlan(parseBilling(all[key])), key).not.toThrow();
  });
});

describe("the billing answer as the screens read it", () => {
  it("no subscription: the trial's allowances apply, a trial can be started, nothing is chosen", () => {
    expect(toWorkspacePlan(parseBilling(billing()))).toMatchObject({ planId: null, state: "none", canStartTrial: true, included: { minutes: 30, messages: 100 }, usage: { minutes: 4.5, messages: 12 }, periodEndsAt: "2026-10-30T12:00:00+05:30" });
  });
  it("trialing: the plan CHOSEN is Growth but the allowances in force are the trial's; the end of the trial is kept", () => {
    const w = toWorkspacePlan(parseBilling(billing({ subscription: sub(), can_start_trial: false })));
    expect(w).toMatchObject({ planId: "growth", state: "trialing", trialEndsAt: "2026-11-12T10:00:00Z", canStartTrial: false, cancelledInTrial: false, included: { minutes: 30, messages: 100 } });
  });
  it("a plan that leaves minutes out reads as 0 included (an upgrade prompt, no bar); pay as you go reads as no ceiling", () => {
    const starter = toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "active", plan_id: "starter", trial_ends_at: null }), usage: { call_minutes: meter("call_minutes", 0, 0, { included: false, state: "stopped" }), whatsapp_messages: meter("whatsapp_messages", 10, 300) } })));
    expect(starter.included).toEqual({ minutes: 0, messages: 300 });
    expect(meterState({ used: starter.usage.minutes, included: starter.included.minutes })).toBe("not_included");
    const payg = toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "active", plan_id: "calls_payg", trial_ends_at: null }), usage: { call_minutes: meter("call_minutes", 42, null), whatsapp_messages: meter("whatsapp_messages", 7, null) } })));
    expect(payg.included).toEqual({ minutes: null, messages: null });
    expect(meterState({ used: 7, included: payg.included.messages })).toBe("no_cap");
    expect(meterState({ used: 42, included: payg.included.minutes })).toBe("no_cap");
  });
  it("calls-only plans include WhatsApp follow-up messages (Calls 300 = 300, Calls 1,000 = 1,000); pay as you go has no ceiling on either kind", () => {
    const cat = catalogueFrom(parsePlans(DRAFT_PLANS));
    expect(callsPlans(cat).map((p) => [p.id, p.callMinutes, p.messages])).toEqual([["calls_payg", null, null], ["calls_300", 300, 300], ["calls_1000", 1000, 1000]]);
    const w = toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "active", plan_id: "calls_300", trial_ends_at: null }), usage: { call_minutes: meter("call_minutes", 10, 300), whatsapp_messages: meter("whatsapp_messages", 240, 300, { state: "notice" }) } })));
    expect(w.included).toEqual({ minutes: 300, messages: 300 });
    expect(meterState({ used: w.usage.messages, included: w.included.messages })).toBe("notice");
  });
  it("access: full by default; read_only carries the day it began, the day the data is deleted and the days left; a body without or with a wrong access is refused", () => {
    expect(toWorkspacePlan(parseBilling(billing()))).toMatchObject({ access: "full", readOnlySince: null, deleteOn: null, dataDaysLeft: null });
    const ro = toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "cancelled", payment_method_on_file: false }), can_start_trial: false, access: "read_only", read_only_since: "2026-10-14", delete_on: "2027-01-12", data_days_left: 79 })));
    expect(ro).toMatchObject({ access: "read_only", readOnlySince: "2026-10-14", deleteOn: "2027-01-12", dataDaysLeft: 79, canStartTrial: false });
    const noAccess = { ...billing() } as unknown as Record<string, unknown>;
    delete noAccess.access;
    expect(() => parseBilling(noAccess)).toThrow();
    expect(() => parseBilling(billing({ access: "frozen" }))).toThrow();
  });
  it("past due carries its grace day; a paid plan that was cancelled carries 'ends at the end of the period'; a cancelled trial is told apart from a cancelled paid plan", () => {
    expect(toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "past_due", trial_ends_at: null, grace_until: "2026-11-19T10:00:00Z" }) }))).graceUntil).toBe("2026-11-19T10:00:00Z");
    expect(toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "active", trial_ends_at: null, current_period_end: "2026-11-12T10:00:00Z", cancel_at_period_end: true }) }))).cancelAtPeriodEnd).toBe(true);
    expect(toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "cancelled" }) }))).cancelledInTrial).toBe(true);
    expect(toWorkspacePlan(parseBilling(billing({ subscription: sub({ status: "cancelled", trial_ends_at: null, current_period_end: "2026-11-12T10:00:00Z" }) }))).cancelledInTrial).toBe(false);
  });
  it("refuses a body that is not the contracted shape (a missing meter, an unknown status, a bad date)", () => {
    expect(() => parseBilling(null)).toThrow();
    expect(() => parseBilling({ ...billing(), usage: {} })).toThrow();
    expect(() => parseBilling(billing({ subscription: sub({ status: "weird" }) }))).toThrow();
    expect(() => parseBilling(billing({ period: { end: "tomorrow" } }))).toThrow();
    expect(() => parseBilling(billing({ can_start_trial: "yes" }))).toThrow();
  });
  it("the test payment choices map to the checkout references of the API's fake provider, and nothing else does", () => {
    expect(CHECKOUT_REF).toEqual({ test_ok: "pm_fake_ok", test_fails: "pm_fake_declines_on_renewal", test_declined: "pm_fake_declined" });
    expect(CHECKOUT_REF.none).toBeUndefined();
  });
});
