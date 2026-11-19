import { describe, expect, it } from "vitest";

import { fmtClock, fmtDay, resultSentence, resultVars, RESULT_CODES } from "./result";

const WORDS: Record<string, string> = {
  "jobs.res.not_sent_window": "{count} messages wait until {opens_at}",
  "jobs.res.not_sent_window.one": "1 message waits until {opens_at}",
  "jobs.res.paused_on": "Paused on {since}",
  "jobs.res.search_left": "{left} left, last {last_search_at}",
  "jobs.res.search_left.never": "{left} left, none yet",
  "jobs.res.other": "Working on it",
};
const t = (key: string, vars: Record<string, string | number> = {}) => (WORDS[key] ?? key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

describe("the result line of a job", () => {
  it("dates are shown the way the shop says them, in India time: '12 Nov', '9 am'", () => {
    expect(fmtDay("2026-11-12T08:00:00Z")).toBe("12 Nov");
    expect(fmtDay("2026-11-30T20:00:00Z")).toBe("1 Dec"); // 01:30 the next day in India
    expect(fmtClock("2026-11-20T03:30:00Z")).toBe("9 am");
    expect(fmtClock("2026-11-20T16:00:00Z")).toBe("9:30 pm");
    expect(fmtDay("soon")).toBe("");
    expect(fmtClock("soon")).toBe("");
  });
  it("the ISO params are formatted, the numbers stay", () => {
    expect(resultVars({ code: "not_sent_window", params: { count: 3, opens_at: "2026-11-20T03:30:00Z" } })).toEqual({ count: 3, opens_at: "9 am" });
    expect(resultVars({ code: "paused_on", params: { since: "2026-11-14T05:00:00Z" } })).toEqual({ since: "14 Nov" });
  });
  it("picks the singular when the count is 1, the 'no search yet' line when there is no date, and the generic line for a code with no words", () => {
    expect(resultSentence(t, { code: "not_sent_window", params: { count: 1, opens_at: "2026-11-20T03:30:00Z" } })).toBe("1 message waits until 9 am");
    expect(resultSentence(t, { code: "not_sent_window", params: { count: 4, opens_at: "2026-11-20T03:30:00Z" } })).toBe("4 messages wait until 9 am");
    expect(resultSentence(t, { code: "search_left", params: { left: 1, per_month: 1 } })).toBe("1 left, none yet");
    expect(resultSentence(t, { code: "search_left", params: { left: 1, per_month: 1, last_search_at: "2026-11-12T08:00:00Z" } })).toBe("1 left, last 12 Nov");
    expect(resultSentence(t, { code: "a_code_from_the_future", params: {} })).toBe("Working on it");
  });
  it("lists the codes of the contract", () => {
    expect([...RESULT_CODES]).toEqual(["calls_today", "answered_today", "not_sent_window", "offer_ready", "reminders_today", "search_left", "paused_on", "needs_approval", "template_needed", "minutes_used", "no_whatsapp", "no_number"]);
  });
});
