import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./client";
import { askErrorOf, parseAskConsent, parseAskFirst } from "./ask-consent";
import { parseCallLimit } from "./call-limit";
import { parsePlan } from "./tasks";

const U = "11111111-1111-4111-8111-111111111111";

describe("ask first: what the API answers is read as numbers and closed codes", () => {
  it("a WhatsApp ask: how many were queued, how many could not be and why, and the template status", () => {
    expect(parseAskConsent({ how: "whatsapp", asked: 12, queued: 9, blocked: 3, blocked_reasons: { no_opt_in: 3, "Bad Key": 1 }, template_status: "none_registered" })).toEqual({ how: "whatsapp", asked: 12, queued: 9, blocked: 3, blockedReasons: { no_opt_in: 3 }, templateStatus: "none_registered", newAction: null, newTaskId: null });
  });
  it("'I confirm they agreed': a NEW plan card for a waiting plan, or a new task id for a started one; nothing else is trusted", () => {
    const card = { type: "confirm_action", action_id: U };
    expect(parseAskConsent({ how: "owner_confirms", asked: 5, new_action: card })).toMatchObject({ how: "owner_confirms", asked: 5, newAction: card, newTaskId: null });
    expect(parseAskConsent({ how: "owner_confirms", asked: 5, new_task_id: U })).toMatchObject({ newTaskId: U });
    expect(parseAskConsent({ how: "owner_confirms", asked: 5, new_task_id: "nope" }).newTaskId).toBeNull();
  });
  it("an answer that is not the contract is refused", () => {
    expect(() => parseAskConsent({ how: "email", asked: 1 })).toThrow();
    expect(() => parseAskConsent({ how: "whatsapp" })).toThrow();
    expect(() => parseAskConsent(null)).toThrow();
  });
  it("the ask-first items: one per plan, with the number of people and how many were already asked; unusable rows are dropped", () => {
    const items = parseAskFirst({ items: [{ task_id: U, goal: "Call new leads", channel: "call", status: "done", created_at: "2026-11-14T05:00:00Z", people: 12, asked: 4 }, { task_id: "bad", people: 3, created_at: "2026-11-14T05:00:00Z" }, { task_id: U, people: 0, created_at: "2026-11-14T05:00:00Z" }] });
    expect(items).toEqual([{ taskId: U, goal: "Call new leads", channel: "call", status: "done", createdAt: "2026-11-14T05:00:00Z", people: 12, asked: 4 }]);
    expect(() => parseAskFirst({})).toThrow();
  });
  it("a failed ask is one closed word", () => {
    expect(askErrorOf(new ApiRequestError(409, "action_state", "x"))).toBe("state");
    expect(askErrorOf(new ApiRequestError(422, "nobody_to_ask", "x"))).toBe("nobody");
    expect(askErrorOf(new ApiRequestError(403, "forbidden", "x"))).toBe("forbidden");
    expect(askErrorOf(new Error("boom"))).toBe("down");
  });
  it("the calls-a-day limit is read whole and strictly", () => {
    expect(parseCallLimit({ limit: 100, used: 23, remaining: 77, default_limit: 100 })).toEqual({ limit: 100, used: 23, remaining: 77, defaultLimit: 100 });
    expect(() => parseCallLimit({ limit: "100", used: 0, remaining: 0, default_limit: 100 })).toThrow();
    expect(() => parseCallLimit(null)).toThrow();
  });
  it("a task's plan carries who it left out for want of consent (tolerant: no `consent`, or a bad one, is none) and a pause at today's call limit is a pause reason", () => {
    const base = { channel: "call", goal: "g", questions: [], script_notes: "", message_text: null, window: { date: "2026-11-14", from_minute: 600, to_minute: 1140 }, contacts_total: 3, contacts_sample: [], unmatched: [], notes: [] };
    expect(parsePlan({ ...base, consent: { skipped: 4, reason_counts: { no_consent: 3, opted_out: 1 } } }).consent).toEqual({ skipped: 4, no_consent: 3 });
    expect(parsePlan(base).consent).toBeNull();
    expect(parsePlan({ ...base, consent: { skipped: "x" } }).consent).toBeNull();
    expect(parsePlan({ ...base, consent: { skipped: 2 } }).consent).toEqual({ skipped: 2, no_consent: 0 });
  });
});
