import { describe, expect, it } from "vitest";

import type { SourceRow } from "@/lib/outreach/types";

import { barWidths, buildFunnel, calledCount, costResults, isRangeKey, noResults, quoteFigures, rangeOf, sourceResults, type StageCounts } from "./results";

const NOON = Date.parse("2026-11-13T06:30:00Z"); // Friday 13 Nov 2026, India
const src = (over: Partial<SourceRow>): SourceRow => ({ source: "indiamart", leads: 10, firstTouchMedianSeconds: 60, calls: 12, connectedRate: 50, interestedPct: 20, bookings: 2, callCostPaise: 1000, leadCostPaise: 4000, costPerBookingPaise: 2500, ...over });

describe("the ranges", () => {
  it("are this week (Monday to today), the last 7 days and the last 30 days, in India dates", () => {
    expect(rangeOf("week", NOON)).toEqual({ key: "week", from: "2026-11-09", to: "2026-11-13" });
    expect(rangeOf("7", NOON)).toEqual({ key: "7", from: "2026-11-07", to: "2026-11-13" });
    expect(rangeOf("30", NOON)).toEqual({ key: "30", from: "2026-10-15", to: "2026-11-13" });
    expect(isRangeKey("30")).toBe(true);
    expect(isRangeKey("90")).toBe(false);
  });
});

describe("the funnel", () => {
  it("runs enquiries, called, visits, quotes, won, each with the step before it", () => {
    const f = buildFunnel({ enquiries: 40, called: 31, visits: 9, quotes: 5, won: 2 });
    expect(f.map((s) => s.id)).toEqual(["enquiries", "called", "visits", "quotes", "won"]);
    expect(f.map((s) => s.previous)).toEqual([null, 40, 31, 9, 5]);
  });
  it("skips a step that could not be read when it names the step before", () => {
    const f = buildFunnel({ enquiries: null, called: null, visits: 9, quotes: null, won: 2 });
    expect(f.map((s) => s.previous)).toEqual([null, null, null, 9, 9]);
    expect(f[4]).toMatchObject({ id: "won", value: 2, previous: 9 });
    expect(f[3]).toMatchObject({ id: "quotes", value: null, previous: 9 });
  });
  it("sizes the bars against the largest step, never thinner than 2 and 0 for a step that is not there", () => {
    expect(barWidths([40, 31, 9, 5, 2])).toEqual([100, 78, 23, 13, 5]);
    expect(barWidths([1000, 1])).toEqual([100, 2]);
    expect(barWidths([null, 0, 4])).toEqual([0, 0, 100]);
    expect(barWidths([0, 0])).toEqual([0, 0]);
  });
  it("counts 'called' as the calls that were answered, never more than the enquiries", () => {
    expect(calledCount({ leads: 40, calls: 60, connectedRate: 50 })).toBe(30);
    expect(calledCount({ leads: 10, calls: 60, connectedRate: 90 })).toBe(10);
    expect(calledCount({ leads: 0, calls: 0, connectedRate: 0 })).toBe(0);
  });
});

describe("the sources", () => {
  const rows = [src({ source: "justdial", leads: 5, bookings: 0, costPerBookingPaise: null }), src({ source: "indiamart", bookings: 4, costPerBookingPaise: 3000 }), src({ source: "meta_lead_ads", leads: 30, bookings: 4, costPerBookingPaise: 1800 })];
  it("lists the sources that brought visits first, then by enquiries", () => {
    expect(sourceResults(rows).map((r) => [r.source, r.visits])).toEqual([["meta_lead_ads", 4], ["indiamart", 4], ["justdial", 0]]);
  });
  it("ranks the cost of a visit, cheapest first, and leaves out a source with no visit", () => {
    expect(costResults(sourceResults(rows))).toEqual([{ source: "meta_lead_ads", paise: 1800 }, { source: "indiamart", paise: 3000 }]);
  });
  it("knows when there is nothing to show", () => {
    const zero: StageCounts = { enquiries: 0, called: 0, visits: 0, quotes: null, won: null };
    expect(noResults(zero, [])).toBe(true);
    expect(noResults({ ...zero, visits: 1 }, [])).toBe(false);
    expect(noResults(zero, sourceResults(rows))).toBe(false);
  });
});

describe("the quotes", () => {
  it("counts the live quotes made in the range and adds them up in paise", () => {
    const q = [
      { total_paise: 100_000, created_at: "2026-11-10T04:00:00Z", status: "approved" },
      { total_paise: 50_000, created_at: "2026-11-11T04:00:00Z", status: "draft" },
      { total_paise: 70_000, created_at: "2026-11-11T04:00:00Z", status: "rejected" },
      { total_paise: 90_000, created_at: "2026-11-02T04:00:00Z", status: "approved" },
      { total_paise: 10_000, created_at: "2026-11-10T04:00:00Z", status: "superseded" },
    ];
    expect(quoteFigures(q, { from: "2026-11-09", to: "2026-11-13" })).toEqual({ count: 2, paise: 150_000 });
  });
});
