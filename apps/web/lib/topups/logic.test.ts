import { describe, expect, it } from "vitest";

import { MAX_CAP_PAISE, parseSettingsInput, rupeesToPaise } from "./input";
import { addDays, alertLevel, count, dayLabel, daysBetween, istDay, monthPeriod, projectRunOut, worstMeter } from "./logic";

describe("India days and the month window", () => {
  it("a moment late in the evening UTC is already the next day in India", () => {
    expect(istDay(new Date("2026-10-31T19:00:00Z"))).toBe("2026-11-01");
    expect(istDay(new Date("2026-10-31T18:29:59Z"))).toBe("2026-10-31");
    expect(istDay(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11-01");
  });
  it("the month in India time: first and last day, days in it, days left counting today", () => {
    expect(monthPeriod(new Date("2026-10-06T10:00:00+05:30"))).toEqual({ start: "2026-10-01", end: "2026-10-31", days: 31, daysLeft: 26 });
    expect(monthPeriod(new Date("2026-11-30T23:59:00+05:30"))).toEqual({ start: "2026-11-01", end: "2026-11-30", days: 30, daysLeft: 1 });
    expect(monthPeriod(new Date("2028-02-10T12:00:00+05:30"))).toMatchObject({ start: "2028-02-01", end: "2028-02-29", days: 29 }); // a leap year
    expect(monthPeriod(new Date("2026-12-31T20:00:00Z"))).toMatchObject({ start: "2027-01-01", end: "2027-01-31", days: 31, daysLeft: 31 }); // 01:30 on 1 Jan in India
  });
  it("adds and counts plain days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
  });
});

describe("the day a meter runs out at this period's pace", () => {
  const period = { periodStart: "2026-10-01", periodEnd: "2026-10-31" };
  it("uses what was used so far, carried forward from the start of the period", () => {
    // 241.5 used in 5.4167 days = 44.58 a day: 300 is reached after 6.73 days from the 1st, on the 7th
    expect(projectRunOut({ used: 241.5, allowance: 300, ...period, now: new Date("2026-10-06T10:00:00+05:30") })).toBe("2026-10-07");
    // 100 in 10 days = 10 a day: 300 after 30 days, on the 31st: still inside the period
    expect(projectRunOut({ used: 100, allowance: 300, ...period, now: new Date("2026-10-11T00:00:00+05:30") })).toBe("2026-10-31");
  });
  it("is null when nothing is used, there is no ceiling, or the pace does not use it up before the period ends", () => {
    const now = new Date("2026-10-11T00:00:00+05:30");
    expect(projectRunOut({ used: 0, allowance: 300, ...period, now })).toBeNull();
    expect(projectRunOut({ used: 5, allowance: null, ...period, now })).toBeNull();
    expect(projectRunOut({ used: 5, allowance: 0, ...period, now })).toBeNull();
    expect(projectRunOut({ used: 50, allowance: 300, ...period, now })).toBeNull(); // 5 a day: 60 days
  });
  it("is null when it is already used up (the screen says so instead of a date)", () => {
    expect(projectRunOut({ used: 300, allowance: 300, ...period, now: new Date("2026-10-11T00:00:00+05:30") })).toBeNull();
    expect(projectRunOut({ used: 350, allowance: 300, ...period, now: new Date("2026-10-11T00:00:00+05:30") })).toBeNull();
  });
  it("counts the first day as a whole day, so a burst on the first morning does not give an absurd date", () => {
    // 60 minutes in the first two hours of the month: pace is taken as 60 a day, not 720
    expect(projectRunOut({ used: 60, allowance: 300, ...period, now: new Date("2026-10-01T02:00:00+05:30") })).toBe("2026-10-06");
  });
  it("works across the India day boundary (the period starts at midnight India time)", () => {
    // now is 31 Oct 19:00 UTC = 1 Nov 00:30 India: that is day 1 of November's period
    expect(projectRunOut({ used: 10, allowance: 30, periodStart: "2026-11-01", periodEnd: "2026-11-30", now: new Date("2026-10-31T19:00:00Z") })).toBe("2026-11-04");
  });
});

describe("alerts", () => {
  it("80 and 100 follow the meter's state", () => {
    expect(alertLevel({ state: "ok" })).toBe(0);
    expect(alertLevel({ state: "notice" })).toBe(80);
    expect(alertLevel({ state: "stopped" })).toBe(100);
  });
  it("the worst meter first; null while both are fine; level ties go to the first", () => {
    type S = { state: "ok" | "notice" | "stopped"; id: string };
    const a: S = { state: "notice", id: "a" };
    const b: S = { state: "stopped", id: "b" };
    const c: S = { state: "ok", id: "c" };
    expect(worstMeter(a, b)).toBe(b);
    expect(worstMeter(b, a)).toBe(b);
    expect(worstMeter(a, { ...a, id: "a2" })).toBe(a);
    expect(worstMeter(c, { ...c, id: "c2" })).toBeNull();
  });
});

describe("how a count and a day are written", () => {
  it("whole numbers grouped the Indian way, fractions with one decimal", () => {
    expect(count(241.5)).toBe("241.5");
    expect(count(300)).toBe("300");
    expect(count(100000)).toBe("1,00,000");
    expect(count(58.54)).toBe("58.5");
  });
  it("a plain day as day and month", () => {
    expect(dayLabel("2026-11-21")).toBe("21 Nov");
  });
});

describe("what the browser sends for the switches", () => {
  const ok = { autoMinutesPack: "minutes_100", autoMessagesPack: null, autoMonthlyCapPaise: 200000, overageMinutes: false, overageMessages: true, overageMonthlyCapPaise: 50000 };
  it("accepts the whole object", () => {
    expect(parseSettingsInput(ok)).toEqual(ok);
  });
  it("refuses a missing field, a wrong type, a negative or fractional cap, a cap over the maximum and a pack name that is not a code", () => {
    for (const bad of [null, "x", [], {}, { ...ok, autoMonthlyCapPaise: -1 }, { ...ok, autoMonthlyCapPaise: 10.5 }, { ...ok, overageMonthlyCapPaise: MAX_CAP_PAISE + 1 }, { ...ok, overageMinutes: "yes" }, { ...ok, autoMinutesPack: "Minutes 100!" }, { ...ok, autoMessagesPack: 3 }, { ...ok, overageMessages: undefined }]) {
      expect(parseSettingsInput(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it("rupees as typed become whole paise", () => {
    expect(rupeesToPaise("2,000")).toBe(200000);
    expect(rupeesToPaise("₹ 2000.5")).toBe(200050);
    expect(rupeesToPaise("12.34")).toBe(1234);
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("-5")).toBeNull();
  });
});
