import { describe, expect, it } from "vitest";

import { dayHeading, dayShort, indiaDayText, isDay, shiftDay, todayInIndia, weekdayName } from "./dates";

describe("calendar days of the Visits page", () => {
  it("knows a real calendar date from text that only looks like one", () => {
    expect(isDay("2026-10-14")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "14/10/2026", "2026-10-14T00:00", "", null, 5, undefined]) expect(isDay(bad), String(bad)).toBe(false);
  });
  it("today is the day in India, whatever zone the machine is in", () => {
    expect(todayInIndia(Date.parse("2026-10-14T04:30:00Z"))).toBe("2026-10-14");
    expect(todayInIndia(Date.parse("2026-10-13T19:00:00Z"))).toBe("2026-10-14"); // past midnight in India
    expect(todayInIndia(Date.parse("2026-10-14T18:29:00Z"))).toBe("2026-10-14");
    expect(todayInIndia(Date.parse("2026-10-14T18:30:00Z"))).toBe("2026-10-15");
  });
  it("moves a day over month and year ends and a leap day", () => {
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2026-10-14", 61)).toBe("2026-12-14");
    expect(shiftDay("not a day", 1)).toBe("not a day");
  });
  it("writes the day in English the Indian way, and in the other languages by their own locale", () => {
    expect(dayHeading("2026-10-14", "en")).toBe("Wednesday, 14 October 2026");
    expect(dayShort("2026-10-14", "en")).toMatch(/Wed.*14.*Oct/);
    expect(dayHeading("2026-10-14", "hi")).toContain("2026");
    expect(dayHeading("2026-10-14", "te")).toMatch(/[ఀ-౿]/);
    expect(dayHeading("2026-10-14", "kn")).toMatch(/[ಀ-೿]/);
  });
  it("names the weekdays Monday first", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => weekdayName(i, "en"))).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  });
  it("writes a moment as its Indian day, the Indian way", () => {
    expect(indiaDayText("2026-10-02T05:00:00+00:00")).toBe("2 Oct 2026");
    expect(indiaDayText("2026-10-01T19:00:00Z")).toBe("2 Oct 2026"); // past midnight in India
    expect(indiaDayText("2026-10-02T05:00:00Z", "te")).toMatch(/[ఀ-౿]/);
  });
});
