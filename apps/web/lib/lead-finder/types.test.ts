import { describe, expect, it } from "vitest";

import { reasonKey, resultNumbers, rupees, searchTextProblem, settingsChanges, type FinderSettings } from "./types";

const STORED: FinderSettings = { fitBar: 70, dailyCallCap: 20, callFromHour: 10, callToHour: 19, searchesPerDay: 5, resultsPerSearch: 20, updatedAt: null };

describe("the settings form's checks (contract section 6)", () => {
  it("sends only what changed", () => {
    expect(settingsChanges(STORED, { fitBar: "75", dailyCallCap: "20", callFromHour: "10", callToHour: "19", searchesPerDay: "5", resultsPerSearch: "20" })).toEqual({ ok: true, changes: { fitBar: 75 } });
    expect(settingsChanges(STORED, {})).toEqual({ ok: true, changes: {} });
  });
  it.each([
    ["fitBar", "49"], ["fitBar", "101"], ["dailyCallCap", "-1"], ["dailyCallCap", "501"], ["callFromHour", "8"], ["callToHour", "22"], ["searchesPerDay", "0"], ["searchesPerDay", "21"], ["resultsPerSearch", "21"], ["fitBar", "7.5"], ["fitBar", ""], ["fitBar", "seventy"],
  ] as const)("refuses %s = %j as out of range", (field, value) => {
    expect(settingsChanges(STORED, { [field]: value })).toEqual({ ok: false, problem: { field, kind: "range" } });
  });
  it("takes the edges of every range", () => {
    expect(settingsChanges(STORED, { fitBar: "50", dailyCallCap: "0", callFromHour: "9", callToHour: "21", searchesPerDay: "20", resultsPerSearch: "1" }).ok).toBe(true);
    expect(settingsChanges(STORED, { fitBar: "100", dailyCallCap: "500", searchesPerDay: "1", resultsPerSearch: "20" }).ok).toBe(true);
  });
  it("the calling hours must start before they end (the stored hour counts for the one not changed)", () => {
    expect(settingsChanges(STORED, { callFromHour: "19" })).toEqual({ ok: false, problem: { field: "callFromHour", kind: "hours" } });
    expect(settingsChanges(STORED, { callToHour: "10" })).toEqual({ ok: false, problem: { field: "callToHour", kind: "hours" } });
    expect(settingsChanges(STORED, { callFromHour: "12", callToHour: "11" })).toEqual({ ok: false, problem: { field: "callFromHour", kind: "hours" } });
    expect(settingsChanges(STORED, { callFromHour: "9", callToHour: "10" })).toEqual({ ok: true, changes: { callFromHour: 9, callToHour: 10 } });
  });
});

describe("small words of the screens", () => {
  it("a reason has its key, none has none", () => {
    expect(reasonKey("low_stock")).toBe("lf.reason.low_stock");
    expect(reasonKey(null)).toBeNull();
  });
  it("the result card's numbers: an absent key is 0", () => {
    expect(resultNumbers({ counts: null })).toEqual({ new: 0, call_ready: 0, needs_owner: 0, skipped: 0 });
    expect(resultNumbers({ counts: { found: 20, new: 18, duplicates: 2, call_ready: 0, needs_owner: 11, skipped: 7, researching: 0, duplicate_customer: 1, duplicate_company: 0, duplicate_prospect: 1, duplicate_suppressed: 0 } })).toEqual({ new: 18, call_ready: 0, needs_owner: 11, skipped: 7 });
  });
  it("rupees from paise", () => {
    expect(rupees(0)).toBe("₹0");
    expect(rupees(2950)).toBe("₹29.50");
    expect(rupees(1850000)).toBe("₹18,500");
  });
  it("the search words: 2 to 300 characters", () => {
    expect(searchTextProblem(" a ")).toBe("empty");
    expect(searchTextProblem("x".repeat(301))).toBe("too_long");
    expect(searchTextProblem("find new retailers in Jayanagar")).toBeNull();
  });
});
