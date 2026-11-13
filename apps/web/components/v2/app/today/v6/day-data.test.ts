import { describe, expect, it } from "vitest";

import { DAY_END, DAY_START, buildDay, clockText, indiaParts, pctOf } from "./day-data";

/** 13 Nov 2026, 10:40 in India. */
const NOW = Date.parse("2026-11-13T10:40:00+05:30");
const at = (hhmm: string, day = "2026-11-13") => `${day}T${hhmm}:00+05:30`;

describe("the minute of the day in India", () => {
  it("reads the day and the minute in the business's own zone, whatever the server's", () => {
    expect(indiaParts("2026-11-13T05:10:00Z")).toEqual({ day: "2026-11-13", minute: 10 * 60 + 40 });
    expect(indiaParts("2026-11-12T20:00:00Z")).toEqual({ day: "2026-11-13", minute: 60 + 30 });
    expect(clockText(9 * 60 + 5)).toBe("09:05");
  });
  it("puts 9 am at the start of the track, 9 pm at the end, and clamps what is outside", () => {
    expect([pctOf(DAY_START), pctOf(DAY_END), pctOf(15 * 60), pctOf(8 * 60), pctOf(23 * 60)]).toEqual([0, 100, 50, 0, 100]);
  });
});

describe("Your day", () => {
  it("draws today's calls as dots in three lanes, the visits as pins with name and time, and the Now line", () => {
    const v = buildDay({ now: NOW, calls: [at("09:05"), at("09:20"), at("09:35"), at("10:10"), at("08:00", "2026-11-12")], visits: [{ startsAt: at("11:00"), who: "Anitha" }, { startsAt: at("15:30"), who: "Lakshmi & mother" }, { startsAt: at("11:00", "2026-11-14"), who: "Tomorrow" }], sent: 2, planned: null });
    expect(v.calls.map((c) => c.lane)).toEqual([0, 1, 2, 0]); // yesterday's call is not today's
    expect(v.handled).toBe(4);
    expect(v.visits).toEqual([{ pct: 16.67, name: "Anitha", time: "11:00" }, { pct: 54.17, name: "Lakshmi & mother", time: "15:30" }]);
    expect(v.now).toEqual({ pct: 13.89, time: "10:40" });
    expect(v.sent).toBe(2);
    expect(v.hours.map((h) => h.label)).toEqual(["9am", "11am", "1pm", "3pm", "5pm", "7pm", "9pm"]);
  });

  it("plans the call-backs from the next half hour, six minutes apart, and says how many and when", () => {
    const v = buildDay({ now: NOW, calls: [], visits: [], sent: null, planned: { n: 4, toMinute: 20 * 60 } });
    expect(v.next).toEqual({ n: 4, time: "11:00" });
    expect(v.planned).toHaveLength(4);
    expect(v.planned[1] - v.planned[0]).toBeCloseTo(0.83, 1);
  });
  it("never plans past the end of the calling hours or more than twelve", () => {
    const late = Date.parse("2026-11-13T19:50:00+05:30");
    expect(buildDay({ now: late, calls: [], visits: [], sent: null, planned: { n: 5, toMinute: 20 * 60 } }).next).toEqual({ n: 1, time: "20:00" });
    expect(buildDay({ now: late, calls: [], visits: [], sent: null, planned: { n: 5, toMinute: 19 * 60 } }).next).toBeNull();
    expect(buildDay({ now: NOW, calls: [], visits: [], sent: null, planned: { n: 40, toMinute: null } }).planned).toHaveLength(12);
  });

  it("leaves out what cannot be read: no calls read = no 'handled', no Now line outside the working day", () => {
    const night = Date.parse("2026-11-13T23:10:00+05:30");
    const v = buildDay({ now: night, calls: null, visits: null, sent: null, planned: null });
    expect(v).toMatchObject({ handled: null, sent: null, next: null, now: null, calls: [], visits: [], planned: [] });
  });
});
