import { describe, expect, it } from "vitest";

import { parseTask } from "@/lib/api/tasks";

import { hourText, workingFrom } from "./lower-data";

const task = (over: Record<string, unknown> = {}, progress: Record<string, number> = {}) =>
  parseTask({ id: "33333333-3333-4333-8333-333333333333", status: "running", instruction: "Call back last week's 9 enquiries who didn't visit", language: "en", template: "offer_invite", question: null, plan: { channel: "call", goal: "Call.", questions: [], script_notes: "", message_text: null, window: { date: "2026-11-13", from_minute: 600, to_minute: 1200 }, follow_up: { kind: "none", after_hours: 24 }, contacts_total: 9, contacts_sample: [], unmatched: [], notes: [] }, estimate: null, cap_paise: null, spent_paise: 0, pause_reason: null, progress: { total: 9, excluded: 0, waiting: 4, in_progress: 0, done: 5, failed: 0, skipped: 0, reached: 5, positive: 2, ...progress }, plan_sha256: null, simulated: true, wording: "draft", created_at: "2026-11-13T03:00:00Z", approved_at: "2026-11-13T03:35:00Z", finished_at: null, ...over });

describe("hours in words", () => {
  it("says 8 pm, 10:30 am, 12 pm", () => {
    expect([1200, 630, 720, 0].map(hourText)).toEqual(["8 pm", "10:30 am", "12 pm", "12 am"]);
  });
});

describe("'Your assistant is working on'", () => {
  it("is the newest approved job as four steps: picked, called (done), calling the other (now), report (later)", () => {
    const w = workingFrom([task()]);
    expect(w?.title).toBe("Call back last week's 9 enquiries who didn't visit");
    expect(w?.status).toBe("running");
    expect(w?.steps.map((s) => [s.id, s.state, s.n])).toEqual([["picked", "done", 9], ["called", "done", 5], ["calling", "now", 4], ["report", "later", 0]]);
    expect(w?.steps[1].extra).toBe(2);
    expect(w?.steps[2].hoursTo).toBe("8 pm");
  });
  it("nothing called yet: the calls are next, not done", () => {
    const w = workingFrom([task({}, { done: 0, positive: 0, waiting: 9 })]);
    expect(w?.steps.map((s) => s.state)).toEqual(["done", "later", "now", "later"]);
  });
  it("everything called: the report is what is left", () => {
    const w = workingFrom([task({}, { done: 9, waiting: 0, positive: 4 })]);
    expect(w?.steps.map((s) => s.state)).toEqual(["done", "done", "done", "now"]);
  });
  it("only an approved, running or paused job counts; the newest wins; a long instruction is shortened", () => {
    expect(workingFrom([task({ status: "planned" }), task({ status: "done" }), task({ status: "cancelled" })])).toBeNull();
    expect(workingFrom([])).toBeNull();
    const newer = task({ id: "44444444-4444-4444-8444-444444444444", status: "paused", approved_at: "2026-11-13T05:00:00Z", instruction: "x".repeat(200) });
    const w = workingFrom([task(), newer]);
    expect(w?.id).toBe("44444444-4444-4444-8444-444444444444");
    expect(w?.status).toBe("paused");
    expect(w?.title.length).toBeLessThanOrEqual(90);
    expect(w?.title.endsWith("…")).toBe(true);
  });
});
