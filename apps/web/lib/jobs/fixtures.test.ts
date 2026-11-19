import { describe, expect, it } from "vitest";

import { parseDncEntry, parseDncPage } from "@/lib/api/do-not-call-parse";
import { parseJob, parseJobDetail, parseJobs, parseJobsToday, parsePlan, parseSuggestionHeading, parseSuggestions, parseTested } from "@/lib/api/jobs-parse";

import { MOCK_DNC, MOCK_DNC_LIFTED } from "./dnc-mock";
import { mockJobDetail } from "./detail-mock";
import {
  MOCK_ASSISTANT,
  MOCK_DNC_COUNT,
  WIRE_DNC,
  WIRE_DNC_LIFTED,
  WIRE_JOBS,
  WIRE_JOB_VARIANTS,
  WIRE_PLANS,
  WIRE_PLAN_VARIANTS,
  WIRE_SUGGESTIONS_GENERIC,
  WIRE_SUGGESTIONS_NOT_READY,
  WIRE_SUGGESTIONS_TEXTILES,
  WIRE_TEST_CALL,
  WIRE_TEST_MESSAGE,
  wireDncPage,
  wireJobDetail,
  wireToday,
} from "./fixtures";
import { MOCK_JOBS } from "./mock";
import { APPROVAL_KINDS, DAY_CODES, EXCLUDED_CODES, PLAN_BASES, WHEN_STARTS, planBlocked } from "./plan";
import { mockPlan, mockStartedFor, mockSuggestions } from "./plan-mock";
import { NEEDS_TARGETS, PLAN_GATES } from "./types";
import { DNC_HOWS } from "./dnc";
import { RESULT_CODES } from "./result";

/**
 * ONE test holds the mock to the contract (C1's FINAL 1.0): every fixture of lib/jobs/fixtures.ts, in the wire shape the API sends, is parsed by the REAL parsers (lib/api/jobs-parse.ts, lib/api/do-not-call-parse.ts), and the mock modules
 * are made from exactly that. A contract change is an edit of a parser; this test then fails until the fixtures say the same, so the demo can never show a shape the API does not send.
 */
describe("the fixtures are valid instances of the contract's shapes", () => {
  it("jobs: the six of the demo (payment_reminders is v1.1: none) and the variants (every other result code, every plan gate, a code the web does not know)", () => {
    expect(WIRE_JOBS.map(parseJob)).toHaveLength(6);
    expect([...WIRE_JOBS, ...WIRE_JOB_VARIANTS].map(parseJob).some((j) => j.kind === "payment_reminders")).toBe(false);
    expect(parseJobs({ items: [...WIRE_JOBS, ...WIRE_JOB_VARIANTS] })).toHaveLength(WIRE_JOBS.length + WIRE_JOB_VARIANTS.length);
    expect(MOCK_JOBS).toEqual(WIRE_JOBS.map(parseJob));
    // every result code of the contract is in some fixture, and every plan gate is too
    const codes = new Set([...WIRE_JOBS, ...WIRE_JOB_VARIANTS].map(parseJob).map((j) => j.result.code));
    for (const c of RESULT_CODES) expect(codes.has(c), `result code ${c}`).toBe(true);
    const gates = new Set([...WIRE_JOBS, ...WIRE_JOB_VARIANTS].map(parseJob).map((j) => j.planGate));
    for (const g of PLAN_GATES) expect(gates.has(g), `plan gate ${g}`).toBe(true);
    // the contract's param names, no others
    const params = (code: string) => Object.keys([...WIRE_JOBS, ...WIRE_JOB_VARIANTS].map(parseJob).find((j) => j.result.code === code)!.result.params).sort();
    expect(params("calls_today")).toEqual(["called", "picked_up", "visits"]);
    expect(params("answered_today")).toEqual(["answered", "messages", "missed"]);
    expect(params("not_sent_window")).toEqual(["count", "opens_at"]);
    expect(params("offer_ready")).toEqual(["customers"]);
    expect(params("reminders_today")).toEqual(["confirmed", "sent"]);
    expect(params("search_left")).toEqual(["last_search_at", "left", "per_month"]);
    expect(params("paused_on")).toEqual(["since"]);
    expect(params("needs_approval")).toEqual(["count"]);
    expect(params("template_needed")).toEqual(["count"]);
  });
  it("Today: GET /jobs/today with the full Job objects (plan_gate and fix included), what waits for the owner and the assistant's name", () => {
    const t = parseJobsToday(wireToday());
    expect(t.jobs).toEqual(MOCK_JOBS);
    // plan_gate rides on the same Job object (the demo shop has none blocked; the variants carry every gate)
    expect(parseJobsToday({ ...wireToday(), jobs: [...WIRE_JOBS, ...WIRE_JOB_VARIANTS] }).jobs.some((j) => j.planGate !== null)).toBe(true);
    expect(t.jobs.some((j) => j.fix !== null)).toBe(true);
    expect(t.needsYou.length).toBeGreaterThan(0);
    // each item is {id, code, kind, at, target {type, id}} with a closed target type, nothing else
    for (const n of t.needsYou) {
      expect(Object.keys(n).sort()).toEqual(["at", "code", "id", "kind", "target"]);
      expect(NEEDS_TARGETS).toContain(n.target.type);
    }
    expect(t.assistantName).toBe(MOCK_ASSISTANT);
  });
  it("the page of every job, the failed one included: settings are {main, more} with at most 4 in main and no `area`; hours are the settings from_hour and to_hour; test_channel is call or whatsapp", () => {
    for (const j of WIRE_JOBS) {
      const wire = wireJobDetail(j.id as string)!;
      const settings = wire.settings as { main: unknown[]; more: unknown[] };
      expect(Array.isArray(settings.main) && Array.isArray(settings.more), `${j.kind} settings`).toBe(true);
      expect(settings.main.length, `${j.kind}: at most 4 settings in main`).toBeLessThanOrEqual(4);
      for (const s of [...settings.main, ...settings.more]) expect(Object.keys(s as object), `${j.kind}: no area`).not.toContain("area");
      const d = parseJobDetail(wire);
      expect(d.job.id).toBe(j.id);
      expect(d.settings.filter((s) => !s.more).length).toBeLessThanOrEqual(4);
      for (const s of d.settings) expect(s.type === "toggle" ? ["on", "off"] : s.options).toContain(s.value);
      for (const k of ["from_hour", "to_hour"]) for (const s of d.settings.filter((x) => x.key === k)) expect(s.options.every((o) => /^\d\d:\d\d$/.test(o))).toBe(true);
      expect([null, "call", "whatsapp"]).toContain(d.test);
      // a toggle is a boolean on the wire and has no options; `when.days` are day codes; the month's cost is {minutes_used, minutes_included, rupees}
      for (const s of [...settings.main, ...settings.more] as { type: string; value: unknown; options?: unknown }[]) if (s.type === "toggle") expect([typeof s.value, "options" in s]).toEqual(["boolean", false]);
      expect((wire.when as { days: string[] }).days.every((x) => (DAY_CODES as readonly string[]).includes(x))).toBe(true);
      expect(Object.keys(wire.cost as object).sort()).toEqual(["minutes_included", "minutes_used", "rupees"]);
      expect(d.cost).toEqual({ minutesUsed: 8, minutesIncluded: 60, rupees: null });
      expect(mockJobDetail(j.id as string)).toEqual(expect.objectContaining({ business: d.business, whatCode: d.whatCode }));
    }
    const failed = parseJobDetail(wireJobDetail(WIRE_JOBS[2].id as string)!);
    expect(failed.job.status).toBe("failed");
    expect(failed.failure).toMatchObject({ code: "template_needed", params: { count: 2 } });
    expect(failed.failure?.items).toHaveLength(2);
    // the researcher's free-search state in results.numbers: only whole numbers are numbers
    const researcher = parseJobDetail(wireJobDetail(WIRE_JOBS[5].id as string)!);
    expect(researcher.results.numbers.map((n) => n.key)).toEqual(expect.arrayContaining(["per_month", "left"]));
    expect(researcher.results.numbers.map((n) => n.key)).not.toContain("last_search_at");
    expect(wireJobDetail("66666666-6666-4666-8666-666666666699")).toBeNull();
  });
  it("plans: the demo's (the swap to WhatsApp and the one that could not tell who included), the variants (named list, WhatsApp first, a blocker each); who.basis.code is from the closed list", () => {
    const all = { ...WIRE_PLANS, ...WIRE_PLAN_VARIANTS };
    for (const [name, wire] of Object.entries(all)) {
      const p = parsePlan(wire);
      expect(PLAN_BASES, name).toContain(p.who.basis.code);
      expect(p.expiresInMinutes === null || p.expiresInMinutes === 30).toBe(true);
    }
    expect(parsePlan(WIRE_PLANS.silk_whatsapp).says[0].channel).toBe("whatsapp");
    expect(parsePlan(WIRE_PLANS.silk_call).alternatives).toEqual([{ kind: "whatsapp", count: 3 }]);
    expect(planBlocked(parsePlan(WIRE_PLANS.unclear))).toBe(true);
    expect(parsePlan(WIRE_PLAN_VARIANTS.named_list).when).toEqual({ start: "tomorrow", fromMin: 540, toMin: 1260, days: ["mon", "tue", "wed", "thu", "fri", "sat"], pacePerHour: 5 });
    // `when {start, from, to, days, pace_per_hour}`: closed words and day codes in every plan; `excluded[].code` is the closed list
    for (const [name, wire] of Object.entries(all)) {
      const p = parsePlan(wire);
      expect(WHEN_STARTS, name).toContain(p.when.start);
      expect(Object.keys((wire.when as object)).sort(), name).toEqual(["days", "from", "pace_per_hour", "start", "to"]);
      for (const e of p.who.excluded) expect(EXCLUDED_CODES, name).toContain(e.code);
    }
    expect(parsePlan(WIRE_PLANS.offers).when.start).toBe("after_ok");
    expect(parsePlan(WIRE_PLAN_VARIANTS.whatsapp_first).primary).toBe("send_whatsapp");
    expect(parsePlan(WIRE_PLAN_VARIANTS.no_number).blockers).toEqual(["no_number"]);
    expect(parsePlan(WIRE_PLAN_VARIANTS.minutes_used).blockers).toEqual(["minutes_used"]);
    // the mock planner answers with exactly these
    expect(mockPlan({ text: "silk sarees" }).planId).toBe("plan-unclear");
    expect(mockPlan({ text: "call the silk saree buyers who bought last month" })).toEqual(parsePlan(WIRE_PLANS.silk_call));
    expect(mockPlan({ as: "whatsapp", planId: "plan-silk-call" })).toEqual(parsePlan(WIRE_PLANS.silk_whatsapp));
    expect(mockPlan({ kind: "offers" })).toEqual(parsePlan(WIRE_PLANS.offers));
  });
  it("suggestions: the saree shop's four with a heading, the plain three, and the ones that are not ready", () => {
    expect(parseSuggestions(WIRE_SUGGESTIONS_TEXTILES)).toHaveLength(4);
    expect(parseSuggestionHeading(WIRE_SUGGESTIONS_TEXTILES)).toBe("saree");
    expect(parseSuggestions(WIRE_SUGGESTIONS_GENERIC)).toHaveLength(3);
    expect(parseSuggestionHeading(WIRE_SUGGESTIONS_GENERIC)).toBeNull();
    expect(parseSuggestions(WIRE_SUGGESTIONS_NOT_READY).map((s) => s.ready)).toEqual([false, false]);
    expect(mockSuggestions(["catalogue", "quotes"]).items).toEqual(parseSuggestions(WIRE_SUGGESTIONS_TEXTILES));
  });
  it("the test buttons answer {placed: true, minutes_used}: a call counts one free minute, a message none", () => {
    expect(parseTested(WIRE_TEST_CALL)).toEqual({ placed: true, minutesUsed: 1 });
    expect(parseTested(WIRE_TEST_MESSAGE)).toEqual({ placed: true, minutesUsed: 0 });
  });
  it("approval.kind is the closed list task, rule, batch, offer, search; the demo's approval is one of them", () => {
    expect(APPROVAL_KINDS).toEqual(["task", "rule", "batch", "offer", "search"]);
    const started = mockStartedFor("offers");
    expect("approval" in started && APPROVAL_KINDS.includes(started.approval.kind)).toBe(true);
  });
  it("Do-Not-Call: every reason (stop_whatsapp, asked_on_call, added_by_owner, other) and who added it; the list holds only active entries, and the lifted ones (include=lifted) carry every closed `how`", () => {
    const entries = WIRE_DNC.map(parseDncEntry);
    expect(MOCK_DNC).toEqual(entries);
    expect(new Set(entries.map((e) => e.reason))).toEqual(new Set(["stop_whatsapp", "asked_on_call", "added_by_owner", "other"]));
    expect(entries.find((e) => e.reason === "added_by_owner")?.addedBy).toBe("Ramesh");
    expect(entries.every((e) => e.state === "active")).toBe(true);
    const lifted = WIRE_DNC_LIFTED.map(parseDncEntry);
    expect(MOCK_DNC_LIFTED).toEqual(lifted);
    expect(lifted.every((e) => e.state === "lifted")).toBe(true);
    expect(lifted.flatMap((e) => e.history).map((h) => h.how).sort()).toEqual([...DNC_HOWS].sort());
    expect(parseDncPage(wireDncPage())).toMatchObject({ count: MOCK_DNC_COUNT, nextCursor: null });
    expect(parseDncPage(wireDncPage()).items).toEqual(entries);
  });
});
