import { describe, expect, it } from "vitest";

import { resultsView } from "./results-data";

const name = (s: string) => s.replace(/_/g, " ");

describe("This week's results", () => {
  it("is the funnel with bars relative to the largest step, and what a visit cost by source, cheapest first", () => {
    const v = resultsView(
      { enquiries: 58, called: 56, visits: 18, quotes: 11, won: 7 },
      [{ source: "instagram_ads", enquiries: 30, visits: 10, costPerVisitPaise: 18000 }, { source: "indiamart", enquiries: 20, visits: 6, costPerVisitPaise: 9500 }, { source: "walk_in", enquiries: 8, visits: 2, costPerVisitPaise: null }],
      name,
    );
    expect(v.stages.map((s) => [s.id, s.value])).toEqual([["enquiries", 58], ["called", 56], ["visits", 18], ["quotes", 11], ["won", 7]]);
    expect(v.stages[0].width).toBe(100);
    expect(v.stages[4].width).toBe(12);
    expect(v.costs).toEqual([{ name: "indiamart", amountText: "₹95", width: 53 }, { name: "instagram ads", amountText: "₹180", width: 100 }]);
  });
  it("leaves out a step it could not read", () => {
    const v = resultsView({ enquiries: 10, called: null, visits: 4, quotes: null, won: null }, [], name);
    expect(v.stages.map((s) => s.id)).toEqual(["enquiries", "visits"]);
    expect(v.costs).toEqual([]);
  });
  it("has nothing to draw when nothing happened this week", () => {
    expect(resultsView({ enquiries: 0, called: 0, visits: 0, quotes: 0, won: 0 }, [], name)).toEqual({ stages: [], costs: [] });
  });
});
