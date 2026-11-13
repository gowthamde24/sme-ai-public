import { describe, expect, it } from "vitest";

import { callingTime, estimateFromPlan, mockEstimate, parseEstimate } from "./estimate";

describe("the estimate of a plan of calls", () => {
  it("reads C1's shape and refuses an odd one", () => {
    const ok = { cost_text: "₹675", time_text: "about 2 h 30 min of calling", total_minutes: 150, included_minutes_used: 0, enough: true, shortfall_text: null };
    expect(parseEstimate(ok)).toEqual({ costText: "₹675", timeText: "about 2 h 30 min of calling", totalMinutes: 150, includedMinutesUsed: 0, enough: true, shortfallText: null });
    expect(parseEstimate({ ...ok, enough: false, shortfall_text: "You need ₹120 more" })?.shortfallText).toBe("You need ₹120 more");
    expect(parseEstimate({ ...ok, total_minutes: -1 })).toBeNull();
    expect(parseEstimate({ ...ok, cost_text: "" })).toBeNull();
    expect(parseEstimate({ ...ok, enough: "yes" })).toBeNull();
    expect(parseEstimate(null)).toBeNull();
    expect(parseEstimate([])).toBeNull();
  });
  it("says the time the way C1 does", () => {
    expect(callingTime(45)).toBe("about 45 min of calling");
    expect(callingTime(120)).toBe("about 2 h of calling");
    expect(callingTime(150)).toBe("about 2 h 30 min of calling");
    expect(callingTime(0)).toBe("about 0 min of calling");
  });
  it("mocks it: minutes in the plan are free, the rest is ₹4.50 a minute from the wallet", () => {
    expect(mockEstimate(50, 3)).toEqual({ costText: "Included in your plan", timeText: "about 2 h 30 min of calling", totalMinutes: 150, includedMinutesUsed: 150, enough: true, shortfallText: null });
    expect(mockEstimate(300, 3)).toMatchObject({ totalMinutes: 900, includedMinutesUsed: 500, costText: "₹1,800", enough: false, shortfallText: "You need ₹250 more" });
    expect(mockEstimate(0, 3).totalMinutes).toBe(0);
  });
  it("makes the same shape from a plan's own numbers", () => {
    expect(estimateFromPlan({ estimatedMinutes: 90, estimatedCostPaise: 40_000 })).toMatchObject({ costText: "₹400", timeText: "about 1 h 30 min of calling", enough: true });
  });
});
