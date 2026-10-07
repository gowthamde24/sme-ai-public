import { describe, expect, it } from "vitest";

import { DECISION_TEXT } from "@/lib/api/followup-text";
import { decisionLine, draftOffers, dueLine, errorState, gateLines, indiaNowLocal, parseGapDays, parseHolidays, policyFromForm, touchTime } from "./followup-logic";

const NOW = new Date("2026-10-07T06:30:00.000Z"); // 12:00 in India

describe("touchTime: empty means now, a typed time is India time, never the future", () => {
  it("empty (or spaces) is now: no time is sent and the database stamps it", () => {
    expect(touchTime("", NOW)).toEqual({ ok: true, value: null });
    expect(touchTime("   ", NOW)).toEqual({ ok: true, value: null });
  });

  it("a typed time is read as India time and sent as an exact instant", () => {
    expect(touchTime("2026-10-07T10:30", NOW)).toEqual({ ok: true, value: "2026-10-07T05:00:00.000Z" });
    expect(touchTime("2026-10-05T00:00", NOW)).toEqual({ ok: true, value: "2026-10-04T18:30:00.000Z" });
  });

  it("both sides of 'now': exactly now is allowed, one minute after is not", () => {
    expect(touchTime("2026-10-07T12:00", NOW)).toEqual({ ok: true, value: "2026-10-07T06:30:00.000Z" });
    const after = touchTime("2026-10-07T12:01", NOW);
    expect(after.ok).toBe(false);
    expect(after.ok === false && after.error).toBe("A touch cannot be in the future. Leave the time empty for now.");
    expect(touchTime("2026-10-07T11:59", NOW).ok).toBe(true);
  });

  it.each(["tomorrow", "2026-10-07", "2026-10-07 10:30", "2026-10-07T10:30:00", "07/10/2026 10:30", "2026-13-01T10:30", "2026-02-30T10:30", "2026-10-07T25:00"])("%s is refused with our sentence", (text) => {
    const r = touchTime(text, NOW);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/^(Enter the date and time|That date and time do not exist)/);
  });

  it("the field's max is the page's own India time", () => {
    expect(indiaNowLocal(NOW)).toBe("2026-10-07T12:00");
    expect(touchTime(indiaNowLocal(NOW), NOW).ok).toBe(true);
  });
});

describe("the policy form's text", () => {
  const values = { effective_from: "2026-10-08", gap_days: "3, 7", max_touches: "3", quiet_start: "21:00", quiet_end: "09:00", holidays: "2026-12-26\n2026-12-25", min_gap_hours: "24", offset_minutes: "330" };

  it("is turned into the typed body: weekdays and holidays sorted", () => {
    const r = policyFromForm(values, ["5", "0", "1"], "id-1");
    expect(r).toEqual({
      ok: true,
      input: { id: "id-1", effectiveFrom: "2026-10-08", gapDays: [3, 7], maxTouches: 3, quietStart: "21:00", quietEnd: "09:00", allowedWeekdays: [0, 1, 5], holidays: ["2026-12-25", "2026-12-26"], minGapHours: 24, recipientUtcOffsetMinutes: 330 },
    });
  });

  it.each([
    ["no touches", { max_touches: "0" }],
    ["too many touches", { max_touches: "101" }],
    ["text for the touches", { max_touches: "three" }],
    ["too few gaps", { gap_days: "3" }],
    ["too many gaps", { gap_days: "3, 7, 9" }],
    ["a gap that is not a number", { gap_days: "3, x" }],
    ["a gap over a year", { gap_days: "3, 366" }],
    ["equal quiet times", { quiet_end: "21:00" }],
    ["a quiet time that is not a time", { quiet_start: "9pm" }],
    ["a holiday that is not a date", { holidays: "Christmas" }],
    ["an impossible holiday", { holidays: "2026-02-30" }],
    ["a repeated holiday", { holidays: "2026-12-25, 2026-12-25" }],
    ["a minimum gap over a year", { min_gap_hours: "8761" }],
    ["an offset beyond fourteen hours", { offset_minutes: "841" }],
    ["no start day", { effective_from: "" }],
  ])("%s is refused with a sentence of ours", (_name, over) => {
    const r = policyFromForm({ ...values, ...over }, ["0"], "id-1");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/^[A-Z].*[.]$/);
  });

  it("at least one weekday, each once, each 0 to 6", () => {
    for (const days of [[], ["7"], ["x"], ["1", "1"]]) expect(policyFromForm(values, days, "id-1").ok).toBe(false);
    expect(policyFromForm({ ...values, max_touches: "1", gap_days: "" }, ["0"], "id-1").ok).toBe(true); // one touch needs no gap
  });

  it("the small parsers", () => {
    expect(parseGapDays("1,2 3")).toEqual([1, 2, 3]);
    expect(parseGapDays("")).toEqual([]);
    expect(parseGapDays("1.5")).toBeNull();
    expect(parseHolidays("2026-12-25, 2026-01-01")).toEqual(["2026-01-01", "2026-12-25"]);
    expect(parseHolidays("")).toEqual([]);
  });
});

describe("which buttons a role is offered for a draft (guidance: the database decides again)", () => {
  const draft = (status: string, by: string | null = "u1") => ({ status, created_by: by }) as Parameters<typeof draftOffers>[0];

  it("the Owner and an Admin approve a draft waiting for approval, with the second factor", () => {
    for (const role of ["owner", "admin"]) {
      expect(draftOffers(draft("draft"), role, "x", "aal2")).toEqual({ approve: true, approveNeedsSecondFactor: false, discard: true, sent: false });
      expect(draftOffers(draft("draft"), role, "x", "aal1")).toMatchObject({ approve: true, approveNeedsSecondFactor: true });
    }
  });

  it("Sales never approves; she discards only her own draft and records 'I sent it' for an approved one", () => {
    expect(draftOffers(draft("draft", "u1"), "sales", "u1", "aal2")).toEqual({ approve: false, approveNeedsSecondFactor: false, discard: true, sent: false });
    expect(draftOffers(draft("draft", "u2"), "sales", "u1", "aal2")).toMatchObject({ discard: false });
    expect(draftOffers(draft("approved", "u2"), "sales", "u1", "aal2")).toEqual({ approve: false, approveNeedsSecondFactor: false, discard: false, sent: true });
  });

  it("an approved draft can be recorded as sent by every writer; a closed one offers nothing; a Viewer is offered nothing", () => {
    for (const role of ["owner", "admin", "sales"]) expect(draftOffers(draft("approved"), role, "u1", "aal2").sent).toBe(true);
    for (const status of ["discarded", "recorded_sent"]) for (const role of ["owner", "admin", "sales"]) expect(draftOffers(draft(status), role, "u1", "aal2")).toEqual({ approve: false, approveNeedsSecondFactor: false, discard: false, sent: false });
    expect(draftOffers(draft("draft"), "viewer", "u1", "aal2")).toEqual({ approve: false, approveNeedsSecondFactor: false, discard: false, sent: false });
    expect(draftOffers(draft("approved"), "viewer", "u1", "aal2").sent).toBe(false);
  });
});

describe("words", () => {
  it("the gate and the stop, one sentence each; nothing blocks is an empty list", () => {
    expect(gateLines({ blocked: null, stopped: null, policy_in_force: true })).toEqual([]);
    expect(gateLines({ blocked: "key", stopped: "order_accepted", policy_in_force: false })).toEqual([
      "No follow-up policy is in force: the owner must publish one.",
      "This e-mail address or phone number is on the do-not-contact list.",
      "An order for this lead was accepted: follow-ups stop.",
    ]);
    expect(gateLines({ blocked: "mystery", stopped: "mystery", policy_in_force: true })).toEqual(["This contact cannot be contacted.", "Follow-ups are stopped for this lead."]);
  });

  it("what the engine said, labelled by the page as guidance", () => {
    expect(decisionLine({ action: "draft_followup", reason_code: "eligible_now", terminal: false, touch_number: 2, next_eligible_at: "2026-10-07T06:30:00Z", engine_version: "1.0.0" }, true)).toBe("A follow-up draft can be made now. (This would be touch 2.)");
    expect(decisionLine({ action: "wait", reason_code: "not_yet_eligible", terminal: false, touch_number: 3, next_eligible_at: "2026-10-08T06:30:00Z", engine_version: "1.0.0" }, true)).toBe("It is not time for the next follow-up yet. Earliest: 2026-10-08 06:30 UTC.");
    expect(decisionLine({ action: "stop", reason_code: "human_takeover", terminal: true, touch_number: 2, next_eligible_at: null, engine_version: "1.0.0" }, true)).toBe("The customer replied: a person takes over.");
    expect(decisionLine({ action: null, reason_code: "FUTURE_HISTORY", terminal: null, touch_number: null, next_eligible_at: null, engine_version: "1.0.0" }, true)).toBe("A touch is recorded after now: wait until it has passed.");
    expect(decisionLine({ action: "stop", reason_code: "brand_new_code", terminal: true, touch_number: 2, next_eligible_at: null, engine_version: "1.0.0" }, true)).toBe("The follow-up rules could not give an answer for this lead.");
    expect(decisionLine(null, true)).toMatch(/No guidance could be given right now/);
    expect(decisionLine(null, false)).toBe("No guidance: no follow-up policy is in force.");
  });

  it("a stop reason the API gives for a stopped lead reads as the stop, never as 'a draft can be made'", () => {
    const stop = (reason: string) => ({ action: "stop" as const, reason_code: reason, terminal: true, touch_number: null, next_eligible_at: null, engine_version: "none" });
    expect(decisionLine(stop("order_accepted"), true)).toBe("An order for this lead was accepted: follow-ups stop.");
    expect(decisionLine(stop("order_declined"), true)).toBe("An order for this lead was declined: follow-ups stop.");
    expect(decisionLine(stop("order_cancelled"), true)).toBe("An order for this lead was cancelled: follow-ups stop.");
    expect(decisionLine(stop("quote_withdrawn"), true)).toBe("The quote for this lead was withdrawn: follow-ups stop.");
    expect(decisionLine(stop("lead_archived"), true)).toBe("This lead is archived: follow-ups stop.");
  });

  it("a block the gate names reads as that block (the gate's own sentence), and an erased key is never a decision word", () => {
    const stop = (reason: string) => ({ action: "stop" as const, reason_code: reason, terminal: false, touch_number: null, next_eligible_at: null, engine_version: "none" });
    expect(decisionLine(stop("contact"), true)).toBe("This person has asked not to be contacted.");
    expect(decisionLine(stop("key"), true)).toBe("This e-mail address or phone number is on the do-not-contact list.");
    expect(decisionLine(stop("erased"), true)).toBe("This contact has been erased: nothing new can be recorded about them.");
    expect(decisionLine(stop("consent"), true)).toBe("There is no recorded consent for this channel, or no address for it.");
    expect(Object.keys(DECISION_TEXT)).not.toContain("erased_key");
  });

  it("a line of the due list", () => {
    expect(dueLine({ action: "draft_followup", reason_code: "eligible_now", touch_number: 2, next_eligible_at: null })).toBe("A follow-up draft can be made now. (Touch 2.)");
    expect(dueLine({ action: "wait", reason_code: "not_yet_eligible", touch_number: 3, next_eligible_at: "2026-10-08T06:30:00Z" })).toBe("It is not time for the next follow-up yet. Earliest: 2026-10-08 06:30 UTC.");
    expect(dueLine({ action: "stop", reason_code: "won", touch_number: 2, next_eligible_at: null })).toBe("This lead is won: no follow-up.");
  });
});

describe("errorState: one fixed sentence, and whether the page must be read again", () => {
  it("a stale draft and a mismatch are stale; the second factor and a role refusal are not", () => {
    expect(errorState(409, "followup_stale")).toEqual({ error: "Something changed since this draft was made (the touches, the policy, the contact or the suppression state). Make a new draft.", stale: true });
    expect(errorState(409, "followup_mismatch").stale).toBe(true);
    expect(errorState(409, "draft_state", "not_draft").stale).toBe(true);
    expect(errorState(403, "mfa_required").stale).toBe(false);
    expect(errorState(403, "forbidden").stale).toBe(false);
    expect(errorState(403, "not_your_draft").stale).toBe(false);
    expect(errorState(422, "invalid_value").stale).toBe(false);
  });

  it("an erased key is the sentence of key, in both fields of the state", () => {
    const hidden = errorState(409, "contact_blocked", "erased_key");
    expect(hidden.error).toBe(errorState(409, "contact_blocked", "key").error);
    expect(JSON.stringify(hidden)).not.toMatch(/erased[\s_-]*key|by right/i);
  });
});
