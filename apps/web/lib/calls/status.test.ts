import { describe, expect, it } from "vitest";

import { parseCallRow, type CallRow } from "@/lib/api/calls";

import { byStatus, callsHref, inRange, lineOptions, matchesSearch, narrow, parseCallsQuery, startOfIndiaDay } from "./filter";
import { STATUS_ORDER, callSentence, callStatus, sentenceText, statusCounts } from "./status";

const ID = "99999999-9999-4999-8999-9999999999";
let n = 0;
const row = (over: Record<string, unknown> = {}): CallRow =>
  parseCallRow({ id: `${ID}${String(10 + n++)}`, direction: "inbound", state: "completed", live: false, who: "Priya Rao", created_at: "2026-11-12T09:00:00Z", elapsed_s: 90, outcome: "positive", category: "interested", summary_short: null, ...over }) as CallRow;
const why = (r: string | null) => (r ? `why:${r}` : "");
const W = { "ph.refused": "Not called: {why}.", "outcome.cat.visit_booked": "Visit booked", "outcome.cat.interested": "Interested", "outcome.result.positive": "Went well", "ph.state.no_answer": "No answer" };

describe("the status of a call (C1's status wins; otherwise it is derived)", () => {
  it("uses the API's status when it sends one", () => {
    expect(callStatus(row({ status: "spam" }))).toBe("spam");
    expect(callStatus(row({ status: "bogus" }))).toBe("completed"); // an unknown word is ignored, then derived
  });
  it("derives each of the six from state, refuse reason and end reason", () => {
    expect(callStatus(row({ state: "in_progress", live: true }))).toBe("live");
    expect(callStatus(row({ state: "ringing", live: true }))).toBe("live");
    expect(callStatus(row({ state: "refused", refuse_reason: "outside_hours" }))).toBe("rejected");
    expect(callStatus(row({ state: "refused", refuse_reason: "blocked_caller" }))).toBe("spam");
    expect(callStatus(row({ end_reason: "handover" }))).toBe("transferred");
    expect(callStatus(row({}))).toBe("completed");
    for (const state of ["no_answer", "busy", "voicemail", "failed", "cancelled", "queued"]) expect(callStatus(row({ state, outcome: null, category: null })), state).toBe("no_answer");
  });
  it("counts every status (zeros included) and the total", () => {
    const rows = [row({}), row({}), row({ state: "no_answer" }), row({ state: "refused" }), row({ state: "in_progress", live: true })];
    expect(statusCounts(rows)).toEqual({ all: 5, completed: 2, transferred: 0, no_answer: 1, rejected: 1, spam: 0, live: 1 });
    expect(Object.keys(statusCounts([])).sort()).toEqual(["all", ...STATUS_ORDER].sort());
  });
});

describe("the sentence of a call", () => {
  it("prefers the API's own sentence, then says a refusal, then the summary, the category, the result, the state", () => {
    expect(callSentence(row({ outcome_sentence: "Booked a Saturday visit for 20 sarees." }))).toEqual({ kind: "api", text: "Booked a Saturday visit for 20 sarees." });
    expect(callSentence(row({ state: "refused", refuse_reason: "dnd" }))).toEqual({ kind: "refused", reason: "dnd" });
    expect(callSentence(row({ summary_short: "Wants 20 silk sarees." }))).toEqual({ kind: "summary", text: "Wants 20 silk sarees." });
    expect(callSentence(row({ category: "visit_booked" }))).toEqual({ kind: "category", category: "visit_booked" });
    expect(callSentence(row({ category: null }))).toEqual({ kind: "result", result: "positive" });
    expect(callSentence(row({ category: null, outcome: null, state: "no_answer" }))).toEqual({ kind: "state", state: "no_answer" });
  });
  it("says each in words", () => {
    expect(sentenceText(callSentence(row({ state: "refused", refuse_reason: "dnd" })), W, why)).toBe("Not called: why:dnd.");
    expect(sentenceText(callSentence(row({ category: "visit_booked" })), W, why)).toBe("Visit booked");
    expect(sentenceText(callSentence(row({ category: null })), W, why)).toBe("Went well");
    expect(sentenceText(callSentence(row({ category: null, outcome: null, state: "no_answer" })), W, why)).toBe("No answer");
    expect(sentenceText(callSentence(row({ summary_short: "Wants sarees." })), W, why)).toBe("Wants sarees.");
  });
  it("ignores an API sentence that is empty or too long", () => {
    expect(row({ outcome_sentence: "   " }).outcomeSentence).toBeNull();
    expect(row({ outcome_sentence: "x".repeat(161) }).outcomeSentence).toBeNull();
  });
});

describe("what the row also carries now (cost, length, number)", () => {
  it("parses cost, duration and the labelled number; anything odd is null", () => {
    const c = row({ cost_paise: 1250, duration_s: 61, end_reason: "goodbye", line: { id: "l1", label: "Main ••••• 90129" } });
    expect([c.costPaise, c.durationS, c.endReason, c.line]).toEqual([1250, 61, "goodbye", { id: "l1", label: "Main ••••• 90129" }]);
    const d = row({ cost_paise: -1, duration_s: "x", line: { id: "bad id!", label: "x" } });
    expect([d.costPaise, d.durationS, d.line]).toEqual([null, null, null]);
    expect(row({}).costPaise).toBeNull();
  });
});

describe("the address of the page", () => {
  it("reads the query, ignoring anything unknown", () => {
    expect(parseCallsQuery({ status: "spam", when: "7d", line: "l1", q: "  priya   rao " })).toEqual({ status: "spam", when: "7d", line: "l1", q: "priya rao" });
    expect(parseCallsQuery({ status: "x", when: "year", line: "a b", q: ["one", "two"] })).toEqual({ status: "all", when: "any", line: null, q: "one" });
    expect(parseCallsQuery({}).q).toBe("");
  });
  it("writes only what differs from the defaults, and can point at one call", () => {
    expect(callsHref("/app/tenants/T", {})).toBe("/app/tenants/T/calls");
    expect(callsHref("/app/tenants/T", { status: "all", when: "any", line: null, q: "" })).toBe("/app/tenants/T/calls");
    expect(callsHref("/app/tenants/T", { status: "live", when: "today", q: "ravi" }, "C1")).toBe("/app/tenants/T/calls/C1?status=live&when=today&q=ravi");
  });
});

describe("date, search and the number dropdown", () => {
  const NOW = Date.parse("2026-11-13T02:00:00Z"); // 07:30 on 13 Nov in India
  it("'today' is the Indian day: a call at 23:00 India time the evening before is not today's", () => {
    expect(new Date(startOfIndiaDay(NOW)).toISOString()).toBe("2026-11-12T18:30:00.000Z");
    expect(inRange("2026-11-12T18:00:00Z", "today", NOW)).toBe(false);
    expect(inRange("2026-11-12T19:00:00Z", "today", NOW)).toBe(true);
    expect(inRange("2026-11-07T10:00:00Z", "7d", NOW)).toBe(true);
    expect(inRange("2026-11-06T10:00:00Z", "7d", NOW)).toBe(false);
    expect(inRange("2026-10-15T10:00:00Z", "30d", NOW)).toBe(true);
    expect(inRange("2026-01-01T10:00:00Z", "any", NOW)).toBe(true);
    expect(inRange("garbage", "today", NOW)).toBe(false);
  });
  it("finds a call by name, by part of a number (spaces and dashes ignored), by the summary and by the sentence", () => {
    const a = row({ who: "Priya Rao", summary_short: "Wants 20 Kanchi sarees" });
    const b = row({ who: "+91 98480 12345", category: "visit_booked" });
    expect(matchesSearch(a, "priya", W, why)).toBe(true);
    expect(matchesSearch(a, "rao priya", W, why)).toBe(true);
    expect(matchesSearch(a, "kanchi", W, why)).toBe(true);
    expect(matchesSearch(a, "ravi", W, why)).toBe(false);
    expect(matchesSearch(b, "98480-123", W, why)).toBe(true);
    expect(matchesSearch(b, "visit booked", W, why)).toBe(true);
    expect(matchesSearch(a, "   ", W, why)).toBe(true);
  });
  it("narrow() keeps date, number and search together; byStatus() then picks the chip", () => {
    const rows = [row({ who: "Ravi", created_at: "2026-11-13T01:00:00Z", line: { id: "l1", label: "Main" } }), row({ who: "Ravi K", created_at: "2026-11-01T01:00:00Z", line: { id: "l2", label: "Shop" } }), row({ who: "Sita", state: "no_answer", created_at: "2026-11-13T01:30:00Z", line: { id: "l1", label: "Main" } })];
    const q = parseCallsQuery({ when: "today", line: "l1", q: "ravi" });
    expect(narrow(rows, q, NOW, W, why).map((c) => c.who)).toEqual(["Ravi"]);
    expect(byStatus(rows, "no_answer").map((c) => c.who)).toEqual(["Sita"]);
    expect(byStatus(rows, "all")).toHaveLength(3);
    expect(lineOptions(rows)).toEqual([{ id: "l1", label: "Main" }, { id: "l2", label: "Shop" }]);
    expect(lineOptions([row({})])).toEqual([]);
  });
});

import { defaultCallId, shortWhen } from "./filter";

describe("the call the panel shows by default, and the short time", () => {
  const NOW = Date.parse("2026-11-13T17:00:00Z"); // 22:30 on 13 Nov, India
  it("the live call first, else the newest; filters are respected; nothing = null", () => {
    const rows = [row({ who: "Newest", state: "completed" }), row({ who: "Live one", live: true, state: "in_progress", outcome: null, category: null }), row({ who: "No answer", state: "no_answer", outcome: null, category: null })];
    const q = (o: Record<string, string> = {}) => parseCallsQuery(o);
    expect(defaultCallId(rows, q(), NOW, W, why)).toBe(rows[1].id);
    expect(defaultCallId(rows, q({ status: "completed" }), NOW, W, why)).toBe(rows[0].id);
    expect(defaultCallId(rows, q({ status: "no_answer" }), NOW, W, why)).toBe(rows[2].id);
    expect(defaultCallId([rows[0], rows[2]], q(), NOW, W, why)).toBe(rows[0].id);
    expect(defaultCallId(rows, q({ status: "spam" }), NOW, W, why)).toBeNull();
    expect(defaultCallId([], q(), NOW, W, why)).toBeNull();
  });
  it("'10:22 pm' for a call made today, '12 Nov' for an earlier day, '' for nonsense (India days)", () => {
    expect(shortWhen("2026-11-13T16:52:00Z", NOW, "en")).toMatch(/^10:22\s?pm$/i);
    expect(shortWhen("2026-11-12T16:52:00Z", NOW, "en")).toBe("12 Nov");
    expect(shortWhen("2026-11-12T19:00:00Z", NOW, "en")).toMatch(/pm|am/i); // 00:30 on the 13th India time is already today
    expect(shortWhen("nope", NOW, "en")).toBe("");
  });
});
