import { afterEach, describe, expect, it, vi } from "vitest";

import { goalLength, goalProblem, isTestNumberId, refusedKey, REFUSED_REASONS, REVIEW_REASONS } from "@/lib/calls/test-call";
import { callClock, callerNamed, capturedLabel, correctionBody, refuseGroup, splitCalls, stagesDone } from "@/lib/calls/view";

import { correctCall, getCall, getCallBrief, hangUpCall, listCalls, markCallHandled, parseCallsPage, listTestNumbers, placeTestCall } from "./calls";

const T = "11111111-1111-4111-8111-111111111111";
const C = "33333333-3333-4333-8333-333333333333";
const L = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.unstubAllGlobals());
const stub = (body: unknown) => {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("the calls a Needs-you card makes (C1's /calls)", () => {
  it("reads the lead and the short summary of a call, nothing else", async () => {
    stub({ id: C, lead_id: L, summary_short: "Wants to talk about a bulk order.", transcript: [{ who: "caller", text: "x" }] });
    expect(await getCallBrief("tok", T, C)).toEqual({ leadId: L, gist: "Wants to talk about a bulk order.", visitAt: null });
    stub({ id: C, lead_id: null, summary_short: null, captured: { visit_at: "2026-11-03T10:00:00+05:30" } });
    expect(await getCallBrief("tok", T, C)).toEqual({ leadId: null, gist: null, visitAt: "2026-11-03T10:00:00+05:30" });
    stub({ id: C, lead_id: null, summary_short: null, captured: { visit_at: "Tuesday" } });
    expect((await getCallBrief("tok", T, C)).visitAt).toBeNull();
  });
  it("refuses another call's body, and an id that is not one is never asked for", async () => {
    stub({ id: L });
    await expect(getCallBrief("tok", T, C)).rejects.toThrow();
    await expect(getCallBrief("tok", T, "../x")).rejects.toThrow();
  });
  it("marks a call handled with a POST to its own address", async () => {
    const f = stub({ call_id: C, handled_at: "2026-11-05T10:00:00Z" });
    await markCallHandled("tok", T, C);
    const [url, init] = (f.mock.calls as unknown as [string, RequestInit][])[0];
    expect(String(url)).toMatch(new RegExp(`/v1/tenants/${T}/calls/${C}/handled$`));
    expect(init.method).toBe("POST");
  });
});

// app v4 part 4: the Calls pages (docs/contracts/calls.md)
const ROW = { id: C, direction: "inbound", state: "completed", live: false, who: "Lakshmi", purpose: "inbound", language: "te", created_at: "2026-11-06T05:00:00Z", answered_at: "2026-11-06T05:00:05Z", ended_at: "2026-11-06T05:02:11Z", elapsed_s: 126, duration_s: 126, outcome: "positive", category: "visit_booked", summary_short: "Wants a red Kanchi silk, visiting Saturday", refuse_reason: null, lead_id: L, task_id: null, sandbox: true, simulated: false, ai_disclosed: true, recorded: false, cost_paise: 0, callback_at: null };
describe("the Calls pages' reads and moves", () => {
  it("reads the list, leaving out a row that breaks the contract; the cursor and the poll come along", async () => {
    const f = stub({ items: [ROW, { ...ROW, id: "not-a-uuid" }, { ...ROW, id: "44444444-4444-4444-8444-444444444444", state: "teleported" }, { ...ROW, id: "55555555-5555-4555-8555-555555555555", live: true, state: "in_progress", category: "made_up", lead_id: "../x" }], next_cursor: "2026-11-05T00:00:00Z", poll_after_s: 5 });
    const page = await listCalls("tok", T, "2026-11-06T00:00:00Z");
    expect(page.items.map((c) => c.id)).toEqual([C, "55555555-5555-4555-8555-555555555555"]);
    expect(page.items[1]).toMatchObject({ live: true, category: null, leadId: null });
    expect(page.items[0]).toMatchObject({ who: "Lakshmi", elapsedS: 126, category: "visit_booked", sandbox: true, leadId: L });
    expect(page).toMatchObject({ nextCursor: "2026-11-05T00:00:00Z", pollAfterS: 5 });
    expect(String((f.mock.calls as unknown as [string][])[0][0])).toMatch(new RegExp(`/v1/tenants/${T}/calls\\?state=all&limit=50&cursor=2026-11-06T00%3A00%3A00Z$`));
    expect(() => parseCallsPage({ rows: [] })).toThrow();
  });
  it("reads one call: the summary, what was captured, the transcript (none for Sales) and the correction", async () => {
    stub({ ...ROW, summary: "Lakshmi wants a red Kanchi silk saree.", end_reason: "goodbye", captured: { visit_day: "Saturday", budget: 15000, "Bad Key": "x" }, transcript: [{ who: "caller", text: "అవును", t: 4.2 }, { who: "robot", text: "x" }], correction: { summary: "Wants two sarees.", captured: { visit_day: "Sunday" }, note: "Kanchi pattu means Kanchipuram silk", corrected_at: "2026-11-06T06:00:00Z" } });
    const call = await getCall("tok", T, C);
    expect(call.captured).toEqual({ visit_day: "Saturday", budget: "15000" });
    expect(call.transcript).toEqual([{ who: "caller", text: "అవును", t: 4.2, textEn: null }]);
    expect(call.correction).toEqual({ summary: "Wants two sarees.", captured: { visit_day: "Sunday" }, note: "Kanchi pattu means Kanchipuram silk", correctedAt: "2026-11-06T06:00:00Z" });
    stub({ ...ROW, transcript: null, correction: null });
    expect(await getCall("tok", T, C)).toMatchObject({ transcript: null, correction: null, captured: {} });
    stub({ ...ROW, id: L });
    await expect(getCall("tok", T, C)).rejects.toThrow(); // another call's body
  });
  it("a line's English (text_en) comes along; none when it is empty or the same line", async () => {
    stub({ ...ROW, transcript: [{ who: "caller", text: "అవును, కంచి పట్టు", t: 1, text_en: "Yes, Kanchi silk" }, { who: "assistant", text: "Hello!", t: 2, text_en: "Hello!" }, { who: "caller", text: "సరే", t: 3, text_en: " " }] });
    expect((await getCall("tok", T, C)).transcript!.map((l) => l.textEn)).toEqual(["Yes, Kanchi silk", null, null]);
  });
  it("Correct it and End call: POST to the call's own address", async () => {
    const f = stub({ summary: "Wants two sarees.", captured: {}, note: null, corrected_at: "2026-11-06T06:00:00Z" });
    expect(await correctCall("tok", T, C, { summary: "Wants two sarees." })).toMatchObject({ summary: "Wants two sarees.", correctedAt: "2026-11-06T06:00:00Z" });
    await hangUpCall("tok", T, C);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => [String(u).replace(/^.*\/v1/, "/v1"), i.method])).toEqual([
      [`/v1/tenants/${T}/calls/${C}/correction`, "POST"],
      [`/v1/tenants/${T}/calls/${C}/hang-up`, "POST"],
    ]);
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ summary: "Wants two sarees." });
    await expect(hangUpCall("tok", T, "../x")).rejects.toThrow();
  });
});

describe("the Calls pages' plain words", () => {
  it("says a refusal by its group; a closed word it does not know is one of the call rules", () => {
    expect(refuseGroup("outside_hours")).toBe("time");
    expect(refuseGroup("no_consent")).toBe("permission");
    expect(refuseGroup("minutes_cap")).toBe("limit");
    expect(refuseGroup("something_new")).toBe("rule");
    expect(refuseGroup(null)).toBe("rule");
  });
  it("marks only the steps the customer's timeline shows (this live call is one)", () => {
    expect([...stagesDone(["arrival", "quote"], false)].sort()).toEqual(["enquiry", "quote"]);
    expect(stagesDone(["arrival"], true).has("call")).toBe(true);
    expect(stagesDone([], false).size).toBe(0);
  });
  it("live calls first; a clock; a key in words", () => {
    const rows = parseCallsPage({ items: [ROW, { ...ROW, id: "55555555-5555-4555-8555-555555555555", live: true }] }).items;
    expect(splitCalls(rows)).toMatchObject({ live: [{ live: true }], earlier: [{ id: C }] });
    expect(callClock(126)).toBe("02:06");
    expect(capturedLabel("visit_day")).toBe("Visit day");
  });
  it("a caller has a name only when the API gave one: \"New enquiry\", \"Caller ending 998\" and a bare number are not names", () => {
    expect(callerNamed("Lakshmi")).toBe(true);
    expect(callerNamed("Ravi Kumar")).toBe(true);
    for (const who of ["", "New enquiry", "new enquiry", "Caller ending 998", "+91 98480 22338", "098480 22338", null, undefined]) expect(callerNamed(who), String(who)).toBe(false);
  });
  it("a correction sends only what changed; nothing changed is nothing to send", () => {
    const before = { summary: "Wants a red saree.", captured: { visit_day: "Saturday", budget: "15000" }, note: "" };
    expect(correctionBody(before, before)).toBeNull();
    expect(correctionBody(before, { ...before, note: " Kanchi pattu means Kanchipuram silk " })).toEqual({ note: "Kanchi pattu means Kanchipuram silk" });
    expect(correctionBody(before, { ...before, captured: { visit_day: "Sunday", budget: "" } })).toEqual({ captured: { visit_day: "Sunday" } });
    expect(correctionBody(before, { ...before, summary: "" })).toEqual({ summary: "" });
  });
});

describe("the owner's test call (C1's PR #434, POST /calls/place)", () => {
  const GOOD = "Ask if they would like to visit the shop on Saturday to see the new silk sarees.";
  it("the goal is checked with the API's own rules before anything is asked", () => {
    expect(goalProblem(GOOD)).toBeNull();
    expect(goalProblem("  too short ")).toBe("short");
    expect(goalProblem("x".repeat(401))).toBe("long");
    expect(goalProblem("x".repeat(400))).toBeNull();
    expect(goalProblem("Ring me on 98480 22338 please")).toBe("number");
    expect(goalProblem("Ring me on 98-480-22-338 please")).toBe("number"); // spaces and hyphens are ignored, as the API does
    expect(goalProblem("Our shop opened in 2019 and has 12 staff members here")).toBeNull(); // short numbers are fine
    expect(goalProblem("Mail the owner at owner@example.in about silk")).toBe("email");
    expect(goalProblem("See https://example.in for the sarees")).toBe("link");
    expect(goalProblem("Look at www.example.in for the sarees")).toBe("link");
    expect(goalProblem("First line about silk\nsecond line about cotton")).toBe("line");
    expect(goalProblem("First line about silk\tsecond part here")).toBe("line");
    expect(goalProblem(`${GOOD}\n`)).toBeNull(); // a trailing new line is trimmed away, as the API trims it
    expect(goalProblem("౯౮౪౮౦౨౨౩౩౮ అని చెప్పండి దయచేసి")).toBe("number"); // Telugu digits count too (the API's \d is Unicode)
    expect(goalProblem("కొత్త పట్టు చీరలు చూడటానికి శనివారం రావాలా అని అడగండి")).toBeNull();
  });
  it("characters are counted as the API counts them (code points)", () => {
    expect(goalLength("  abc  ")).toBe(3);
    expect(goalLength("😀".repeat(400))).toBe(400);
    expect(goalProblem("😀".repeat(401))).toBe("long");
  });
  it("a phone is picked by the id of its masked entry (8 to 64 hex characters), never typed", () => {
    for (const ok of ["a1b2c3d4e5f60718", "0123456789abcdef", "abcdef12"]) expect(isTestNumberId(ok), ok).toBe(true);
    for (const bad of ["", "abc", "A1B2C3D4E5F60718", "+919848022338", "../x", "a1b2c3d4e5f60718 ", "x".repeat(65), null, 5]) expect(isTestNumberId(bad), String(bad)).toBe(false);
  });
  it("reads the masked list of test phones, nothing else; an entry that breaks the contract is left out", async () => {
    const f = stub({ items: [{ id: "a1b2c3d4e5f60718", masked: "+91 ••••• 90129", label: null }, { id: "bad id", masked: "+91 ••••• 11111", label: null }, { id: "0123456789abcdef", masked: "ring me <b>", label: null }, { id: "fedcba9876543210", masked: "+91 ••••• 22338", label: "Owner's phone" }] });
    expect(await listTestNumbers("tok", T)).toEqual([{ id: "a1b2c3d4e5f60718", masked: "+91 ••••• 90129", label: null }, { id: "fedcba9876543210", masked: "+91 ••••• 22338", label: "Owner's phone" }]);
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toMatch(new RegExp(`/v1/tenants/${T}/calls/test-numbers$`));
    stub({ nothing: true });
    await expect(listTestNumbers("tok", T)).rejects.toThrow();
  });
  it("every closed word of the gate has its own sentence in the store; an unknown word has the calm one", async () => {
    const { default: store } = await import("@/i18n/strings/app.json");
    const dict = store as Record<string, { en: string; humanOnly?: boolean }>;
    for (const r of REFUSED_REASONS) {
      expect(refusedKey(r)).toBe(`tc.no.${r}`);
      expect(dict[`tc.no.${r}`]?.en, r).toMatch(/No call was made\./);
      expect(Boolean(dict[`tc.no.${r}`].humanOnly), r).toBe((REVIEW_REASONS as readonly string[]).includes(r)); // money, consent and privacy wait for review
    }
    for (const r of [null, undefined, "", "made_up", "constructor", "../x"]) expect(refusedKey(r)).toBe("tc.no.other");
    expect(dict["tc.no.other"].en).toMatch(/If it keeps happening, contact us\./);
  });
  it("POST /calls/place with the picked id, the language and the goal (never a typed number); the answer is the call's id", async () => {
    const f = stub({ call_id: C, state: "ringing" });
    expect(await placeTestCall("tok", T, { toId: "a1b2c3d4e5f60718", language: "te", goal: GOOD })).toEqual({ callId: C });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toMatch(new RegExp(`/v1/tenants/${T}/calls/place$`));
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ to_id: "a1b2c3d4e5f60718", language: "te", goal: GOOD });
    const line = stub({ call_id: C, state: "ringing" }); // the line check: no goal is sent at all, and the language is English whatever was passed
    expect(await placeTestCall("tok", T, { toId: "a1b2c3d4e5f60718", language: "te", goal: null })).toEqual({ callId: C });
    expect(JSON.parse(String((line.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ to_id: "a1b2c3d4e5f60718", language: "en" });
    stub({ call_id: "../x", state: "ringing" });
    await expect(placeTestCall("tok", T, { toId: "a1b2c3d4e5f60718", language: "en", goal: GOOD })).rejects.toThrow();
    stub({ call_id: C, state: "queued" });
    await expect(placeTestCall("tok", T, { toId: "a1b2c3d4e5f60718", language: "en", goal: GOOD })).rejects.toThrow();
  });
});
