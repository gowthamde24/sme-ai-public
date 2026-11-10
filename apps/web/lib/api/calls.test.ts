import { afterEach, describe, expect, it, vi } from "vitest";

import { callClock, callerNamed, capturedLabel, correctionBody, refuseGroup, refuseWhy, splitCalls, stagesDone } from "@/lib/calls/view";

import { correctCall, getCall, getCallBrief, hangUpCall, listCalls, markCallHandled, parseCallsPage } from "./calls";

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
    expect(refuseWhy("dnd")).toBe("dnd");
    expect(refuseWhy("dnd_unknown")).toBe("dnd");
    expect(refuseWhy("no_consent")).toBe("consent");
    expect(refuseWhy("suppressed")).toBe("permission");
    expect(refuseWhy("minutes_cap")).toBe("limit");
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
