import { describe, expect, it } from "vitest";

import { batchBody, parseBatch, parseBatchAnswer, parseHandoffs, parsePlan, parsePolicy, parseReport, parseRule, ruleBody } from "./outreach";

const ID = "11111111-1111-4111-8111-111111111111";
const batch = { id: ID, name: "Diwali leads", status: "planned", paused_reason: null, goal: "site_visit", channel: "both", language: "ml", questions: ["Budget?"], message_text: "Hello", window_days: 7, max_calls_per_day: 50, max_total_minutes: null, plan_sha256: "abc123", created_at: "2026-10-27T10:00:00Z", approved_at: null, finished_at: null };
const plan = { count: 12, ready: 9, skipped: { no_consent: 2, stopped: 1 }, sample: [{ contact_id: ID, name_masked: "R. K.", city: "Guntur" }], window: { from: "2026-10-27", to: "2026-11-03" }, estimated_minutes: 27, estimated_messages: 9, estimated_cost_paise: 11070, caps: { max_calls_per_day: 50, max_total_minutes: null } };

describe("the batch answers of the API (generated contract outreach.ts)", () => {
  it("reads a batch, its plan and its progress", () => {
    const a = parseBatchAnswer({ batch, plan, progress: { total: 9, waiting: 6, done: 3, calls_made: 3, connected: 2, interested: 1, minutes_used: 9 } });
    expect(a.batch).toMatchObject({ id: ID, goal: "site_visit", channel: "both", language: "ml", windowDays: 7, planSha256: "abc123" });
    expect(a.plan).toMatchObject({ count: 12, ready: 9, windowFrom: "2026-10-27", estimatedCostPaise: 11070, maxCallsPerDay: 50, maxTotalMinutes: null });
    expect(a.plan.sample[0]).toEqual({ contactId: ID, nameMasked: "R. K.", city: "Guntur" });
    expect(a.progress?.done).toBe(3);
    expect(parseBatchAnswer({ batch, plan }).progress).toBeNull();
  });
  it("refuses what is not the contract: an unknown goal, language or status, a bad id, money that is not whole paise", () => {
    for (const bad of [{ goal: "sell" }, { language: "xx" }, { status: "flying" }, { id: "x" }, { window_days: 99 }, { channel: "sms" }]) expect(() => parseBatch({ ...batch, ...bad }), JSON.stringify(bad)).toThrow();
    expect(() => parsePlan({ ...plan, estimated_cost_paise: 1.5 })).toThrow();
    expect(() => parsePlan({ ...plan, count: -1 })).toThrow();
    expect(() => parseBatchAnswer(null)).toThrow();
  });
  it("sends the contract's body for a plan and for a rule, with the right 'who'", () => {
    const body = batchBody({ batchId: ID, name: "x", goal: "general", channel: "call", language: "en", who: { kind: "source", source: "indiamart", status: "new", since: "2026-10-01" }, questions: [], messageText: null, windowDays: 3, maxCallsPerDay: null, maxTotalMinutes: 60 });
    expect(body).toMatchObject({ batch_id: ID, who: { source: { source: "indiamart", status: "new", since: "2026-10-01" } }, window_days: 3, max_total_minutes: 60 });
    expect(batchBody({ batchId: ID, name: "x", goal: "general", channel: "call", language: "en", who: { kind: "contacts", ids: [ID] }, questions: [], messageText: null, windowDays: 1, maxCallsPerDay: null, maxTotalMinutes: null }).who).toEqual({ contact_ids: [ID] });
    expect(ruleBody({ ruleId: ID, source: "website_form", action: "call_within_minutes", withinMinutes: 2, goal: "general", channel: "call", language: "en", questions: [], messageText: null, maxCallsPerDay: 50, maxTotalMinutes: null })).toMatchObject({ rule_id: ID, within_minutes: 2, max_calls_per_day: 50 });
  });
});

describe("rules, hand-offs, report and policy", () => {
  it("reads a rule with its usage", () => {
    const r = parseRule({ id: ID, source: "meta_lead_ads", action: "call_within_minutes", within_minutes: 2, goal: "general", channel: "call", language: "en", questions: [], message_text: null, max_calls_per_day: 50, max_total_minutes: null, active: true, paused_reason: null, paused_at: null, approved_at: "2026-10-27T10:00:00Z", usage: { leads: 4, calls_today: 2, minutes_used: 6 } });
    expect(r).toMatchObject({ active: true, withinMinutes: 2, usage: { leads: 4, callsToday: 2 } });
    expect(() => parseRule({ ...r, id: "bad" })).toThrow();
  });
  it("reads the hand-offs as a plain array and refuses an object", () => {
    const row = { id: ID, lead_id: null, contact_id: ID, contact_name: "Ravi", summary: "Wants a visit", assigned_to: ID, notified_at: "2026-10-27T10:00:00Z", reminder_sent_at: null, acted_at: null };
    expect(parseHandoffs([row])[0]).toMatchObject({ contactName: "Ravi", reminderSentAt: null });
    expect(() => parseHandoffs({ items: [row] })).toThrow();
  });
  it("reads the lead report per source with rates in 0..100 and a cost per booking that may be null", () => {
    const row = { source: "indiamart", leads: 10, first_touch_median_seconds: 90, calls: 12, connected_rate: 60.5, interested_pct: 25, bookings: 0, call_cost_paise: 14400, lead_cost_paise: 0, cost_per_booking_paise: null };
    const rep = parseReport({ from_day: "2026-10-20", to_day: "2026-10-26", by_source: [row], total: { leads: 10, calls: 12, connected_rate: 60.5, interested_pct: 25, bookings: 0, call_cost_paise: 14400, lead_cost_paise: 0, cost_per_booking_paise: null } });
    expect(rep.bySource[0]).toMatchObject({ source: "indiamart", costPerBookingPaise: null, connectedRate: 60.5 });
    expect(() => parseReport({ from_day: "a", to_day: "b", by_source: [{ ...row, connected_rate: 101 }], total: row })).toThrow();
  });
  it("reads the calling policy with its hours", () => {
    const p = parsePolicy({ night_call_minute: 570, max_attempts: 3, retry_gap_hours: 18, then_whatsapp: true, whatsapp_after_hours: true, handoff_reminder_minutes: 15, call_paise_per_minute: 400, hours: { days: [1, 2, 3], from_minute: 540, to_minute: 1140, from: "assistant" }, saved: true });
    expect(p).toMatchObject({ nightCallMinute: 570, hours: { days: [1, 2, 3], from: "assistant" }, saved: true });
    expect(() => parsePolicy({ ...p, night_call_minute: 5000 })).toThrow();
  });
});
