import { describe, expect, it } from "vitest";

import { agoOf, checkFaq, checkJobName, effectOf, fmtHhmm, fmtMinutes, linesOf, minutesOf, whenText, type JobSetting } from "./detail";

const s = (key: string, more = false, type: "choice" | "toggle" = "choice"): JobSetting => ({ key, type, value: "a", options: ["a"], more });

describe("the name of a job", () => {
  it("is at most 40 characters; empty or spaces only = back to the plain name; letters of any script are fine", () => {
    expect(checkJobName("  Priya  ")).toEqual({ ok: true, name: "Priya" });
    expect(checkJobName("   ")).toEqual({ ok: true, name: null });
    expect(checkJobName("")).toEqual({ ok: true, name: null });
    expect(checkJobName("ప్రియ")).toEqual({ ok: true, name: "ప్రియ" });
    expect(checkJobName("Lakshmi  Devi")).toEqual({ ok: true, name: "Lakshmi Devi" });
    expect(checkJobName("x".repeat(40)).ok).toBe(true);
    expect(checkJobName("x".repeat(41))).toEqual({ ok: false, why: "long" });
  });
  it("never lets symbols, tags or line breaks reach a voice or a message", () => {
    for (const bad of ["<b>Priya</b>", "Priya; drop", "Pri\u0000ya", "Priya {x}", "Priya 😀"]) expect(checkJobName(bad)).toEqual({ ok: false, why: "chars" });
    expect(checkJobName("Priya\nDevi")).toEqual({ ok: true, name: "Priya Devi" });
  });
});

describe("a FAQ", () => {
  it("needs a question and an answer, trimmed, within bounds", () => {
    expect(checkFaq("  Open on Sundays? ", " Yes. ")).toEqual({ ok: true, question: "Open on Sundays?", answer: "Yes." });
    expect(checkFaq("ab", "x").ok).toBe(false);
    expect(checkFaq("Open?", "").ok).toBe(false);
    expect(checkFaq("q".repeat(301), "x").ok).toBe(false);
    expect(checkFaq("q".repeat(300), "a".repeat(300)).ok).toBe(true);
    expect(checkFaq("Open?", "a".repeat(301)).ok).toBe(false);
    expect(checkFaq("Open?", "Yes\u0007").ok).toBe(false);
  });
});

describe("times and the effect line", () => {
  it("shows 24-hour times the way a shop says them", () => {
    expect(minutesOf("09:30")).toBe(570);
    expect(minutesOf("24:00")).toBeNull();
    expect(fmtMinutes(0)).toBe("12 am");
    expect(fmtMinutes(12 * 60)).toBe("12 pm");
    expect(fmtMinutes(20 * 60 + 15)).toBe("8:15 pm");
    expect(fmtHhmm("19:00")).toBe("7 pm");
    expect(fmtHhmm("junk")).toBe("junk");
  });
  it("Call new enquiries: a form after the calling hours gets a WhatsApp before they open and the call when they open (the mock's 8:15 pm, 9:00 am, 9:30 am)", () => {
    const e = effectOf("speed_to_lead", { response: "right_away", from_hour: "09:30", to_hour: "19:00" }, { who: "Ravi", event_at: "20:15" })!;
    expect(e.who).toBe("Ravi");
    expect(e.steps.map((x) => [x.code, fmtMinutes(x.at)])).toEqual([["form", "8:15 pm"], ["whatsapp", "9 am"], ["call", "9:30 am"]]);
  });
  it("follows the chosen settings: later opening hours and a slower response move the steps; inside the hours it is all at once", () => {
    const late = effectOf("speed_to_lead", { response: "after_15", from_hour: "10:30", to_hour: "19:00" }, { who: "Ravi", event_at: "20:15" })!;
    expect(late.steps.map((x) => fmtMinutes(x.at))).toEqual(["8:15 pm", "10 am", "10:45 am"]);
    const inside = effectOf("speed_to_lead", { response: "after_5", from_hour: "09:30", to_hour: "21:00" }, { who: "Ravi", event_at: "20:15" })!;
    expect(inside.steps.map((x) => fmtMinutes(x.at))).toEqual(["8:15 pm", "8:15 pm", "8:20 pm"]);
  });
  it("followups and visits have their own three steps; a job without inputs, and jobs with no such line, have none", () => {
    expect(effectOf("followups", { from_hour: "10:00" }, { who: "Padma", event_at: "16:00" })!.steps.map((x) => x.code)).toEqual(["asked", "followup", "call"]);
    expect(effectOf("store_visits", { remind_before: "hours_3", from_hour: "10:00" }, { who: "L", booked_at: "11:00", event_at: "16:00" })!.steps.map((x) => fmtMinutes(x.at))).toEqual(["11 am", "1 pm", "4 pm"]);
    expect(effectOf("speed_to_lead", {}, null)).toBeNull();
    expect(effectOf("researcher", {}, { who: "x" })).toBeNull();
  });
});

describe("lines of settings", () => {
  it("the from and to hours share one sentence; a tick is its own line; the order of the API stays", () => {
    const lines = linesOf([s("response"), s("from_hour"), s("to_hour"), s("retries"), s("notify_visit", true, "toggle")]);
    expect(lines).toEqual([{ id: "response", keys: ["response"] }, { id: "hours", keys: ["from_hour", "to_hour"] }, { id: "retries", keys: ["retries"] }, { id: "notify_visit", keys: ["notify_visit"] }]);
  });
});

describe("dates the page shows", () => {
  it("Last run: just now, minutes, hours, days; nothing for a job that never ran", () => {
    const now = Date.parse("2026-11-19T10:00:00Z");
    expect(agoOf(null, now)).toBeNull();
    expect(agoOf("2026-11-19T09:59:40Z", now)).toEqual({ unit: "now", n: 0 });
    expect(agoOf("2026-11-19T09:51:00Z", now)).toEqual({ unit: "min", n: 9 });
    expect(agoOf("2026-11-19T07:00:00Z", now)).toEqual({ unit: "h", n: 3 });
    expect(agoOf("2026-11-12T10:00:00Z", now)).toEqual({ unit: "d", n: 7 });
    expect(agoOf("2026-11-19T11:00:00Z", now)).toEqual({ unit: "now", n: 0 });
  });
  it("a moment is the weekday and the India time", () => {
    expect(whenText("2026-11-21T10:30:00Z", "en")).toBe("Saturday, 4 pm");
    expect(whenText("2026-11-20T04:00:00Z", "en")).toBe("Friday, 9:30 am");
    expect(whenText("nonsense", "en")).toBe("");
  });
});
