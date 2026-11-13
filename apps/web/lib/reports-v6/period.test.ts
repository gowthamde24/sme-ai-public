import { describe, expect, it } from "vitest";

import { MAX_CUSTOM_DAYS, periodHref, periodOf } from "./period";

const NOW = Date.parse("2026-11-13T06:30:00Z"); // Friday 13 Nov 2026, India

describe("the period of the Reports page", () => {
  it("is the last 14 days by default (today and the 13 days before), with the 14 before them as 'previous'", () => {
    const p = periodOf({}, NOW);
    expect(p).toMatchObject({ key: "14", from: "2026-10-31", to: "2026-11-13", previous: { from: "2026-10-17", to: "2026-10-30" } });
    expect(p.days).toHaveLength(14);
    expect(p.days[0]).toBe("2026-10-31");
    expect(p.days[13]).toBe("2026-11-13");
  });
  it("today is one day with yesterday before it; this month runs from the 1st", () => {
    expect(periodOf({ range: "today" }, NOW)).toMatchObject({ key: "today", from: "2026-11-13", to: "2026-11-13", previous: { from: "2026-11-12", to: "2026-11-12" } });
    const m = periodOf({ range: "month" }, NOW);
    expect(m).toMatchObject({ key: "month", from: "2026-11-01", to: "2026-11-13", previous: { from: "2026-10-19", to: "2026-10-31" } });
    expect(m.days).toHaveLength(13);
  });
  it("a custom pair is used when it is real, not in the future, the right way round and not too long", () => {
    expect(periodOf({ range: "custom", from: "2026-11-01", to: "2026-11-05" }, NOW)).toMatchObject({ key: "custom", from: "2026-11-01", to: "2026-11-05" });
    for (const q of [{ from: "2026-11-05", to: "2026-11-01" }, { from: "2026-11-01", to: "2026-11-30" }, { from: "2026-02-30", to: "2026-03-02" }, { from: "2026-01-01", to: "2026-11-13" }, { from: "x", to: "y" }, {}]) {
      expect(periodOf({ range: "custom", ...q }, NOW).key, JSON.stringify(q)).toBe("14");
    }
    expect(MAX_CUSTOM_DAYS).toBe(92);
  });
  it("an unknown range falls back to the default; an array uses its first word", () => {
    expect(periodOf({ range: "year" }, NOW).key).toBe("14");
    expect(periodOf({ range: ["month", "today"] }, NOW).key).toBe("month");
  });
  it("writes its own address", () => {
    expect(periodHref("/b", "14")).toBe("/b/report");
    expect(periodHref("/b", "today")).toBe("/b/report?range=today");
    expect(periodHref("/b", "custom", { from: "2026-11-01", to: "2026-11-05" })).toBe("/b/report?range=custom&from=2026-11-01&to=2026-11-05");
  });
});
