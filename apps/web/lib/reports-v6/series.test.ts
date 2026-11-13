import { describe, expect, it } from "vitest";

import { periodOf } from "./period";
import { callCost, change, countPerDay, enquiryFigures, heatmap, indiaDay, salesFigures, visitFigures, type CallLike, type VisitLike } from "./series";

const NOW = Date.parse("2026-11-13T06:30:00Z");
const P = periodOf({ range: "today" }, NOW);
const P3 = { days: ["2026-11-11", "2026-11-12", "2026-11-13"], previous: { from: "2026-11-08", to: "2026-11-10" } };

describe("counting per day (India days)", () => {
  it("a moment late in the evening UTC is already the next day in India; outside the period is not counted", () => {
    expect(indiaDay("2026-11-12T19:00:00Z")).toBe("2026-11-13");
    expect(countPerDay(["2026-11-11T05:00:00Z", "2026-11-12T19:00:00Z", "2026-11-13T01:00:00Z", "2026-11-01T01:00:00Z", "garbage"], P3.days)).toEqual([1, 0, 2]);
  });
});

describe("enquiries", () => {
  it("per day, in all, in the period before, and by source (most first; no source is 'other')", () => {
    const f = enquiryFigures(
      [
        { createdAt: "2026-11-11T05:00:00Z", source: "indiamart" },
        { createdAt: "2026-11-12T05:00:00Z", source: "indiamart" },
        { createdAt: "2026-11-12T06:00:00Z", source: null },
        { createdAt: "2026-11-13T02:00:00Z", source: "website_form" },
        { createdAt: "2026-11-09T05:00:00Z", source: "indiamart" },
        { createdAt: "2026-10-01T05:00:00Z", source: "indiamart" },
      ],
      P3,
    );
    expect(f).toEqual({ perDay: [1, 2, 1], total: 4, previous: 1, sources: [{ source: "indiamart", count: 2 }, { source: "other", count: 1 }, { source: "website_form", count: 1 }] });
  });
  it("nothing is zeros", () => {
    expect(enquiryFigures([], P)).toEqual({ perDay: [0], total: 0, previous: 0, sources: [] });
  });
});

const v = (date: string, over: Partial<VisitLike> = {}): VisitLike => ({ date, status: "booked", outcome: null, order_id: null, ...over });
describe("visits and sales from visits", () => {
  const visits = [v("2026-11-11"), v("2026-11-12", { outcome: "bought", order_id: "o1" }), v("2026-11-12", { status: "cancelled" }), v("2026-11-13", { outcome: "bought", order_id: "o2" }), v("2026-11-13", { outcome: "bought", order_id: "gone" }), v("2026-11-09", { outcome: "bought", order_id: "o3" }), v("2026-11-09"), v("2026-09-01")];
  it("booked visits per day (cancelled ones do not count), the period before, and the ones that bought", () => {
    const f = visitFigures(visits, P3);
    expect(f).toMatchObject({ perDay: [1, 1, 2], total: 4, previous: 2 });
    expect(f.bought.map((x) => x.order_id)).toEqual(["o1", "o2", "gone"]);
  });
  it("sales add up the orders of the visits that bought, by visit day; an order that cannot be found is counted as missing, not as zero", () => {
    const s = salesFigures(visits, new Map([["o1", 100_000], ["o2", 250_000], ["o3", 40_000]]), P3);
    expect(s).toEqual({ perDay: [0, 100_000, 250_000], total: 350_000, previous: 40_000, missing: 1 });
  });
  it("no sales is zero everywhere", () => {
    expect(salesFigures([], new Map(), P3)).toEqual({ perDay: [0, 0, 0], total: 0, previous: 0, missing: 0 });
  });
});

describe("change", () => {
  it("up, down or the same, with the difference and the whole percent of the earlier figure", () => {
    expect(change(58, 47.5)).toMatchObject({ dir: "up" });
    expect(change(12, 10)).toEqual({ dir: "up", diff: 2, percent: 20 });
    expect(change(5, 10)).toEqual({ dir: "down", diff: 5, percent: 50 });
    expect(change(3, 3)).toEqual({ dir: "same", diff: 0, percent: 0 });
    expect(change(4, 0)).toEqual({ dir: "up", diff: 4, percent: null });
  });
});

const call = (iso: string, over: Partial<CallLike> = {}): CallLike => ({ createdAt: iso, direction: "inbound", costPaise: 500, ...over });
describe("what the calls cost the customer", () => {
  it("adds the cost of the calls in the period; calls with no cost are not counted; none at all is null", () => {
    expect(callCost([call("2026-11-12T05:00:00Z"), call("2026-11-13T05:00:00Z", { costPaise: 250 }), call("2026-11-13T05:00:00Z", { costPaise: null }), call("2026-10-01T05:00:00Z")], P3)).toBe(750);
    expect(callCost([call("2026-11-12T05:00:00Z", { costPaise: null })], P3)).toBeNull();
    expect(callCost([], P3)).toBeNull();
  });
});

describe("busiest times", () => {
  // Saturday 7 Nov 2026: 17:30 India = 12:00 UTC
  const sat = (h: number, m = 0) => `2026-11-07T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
  it("counts incoming calls by weekday and India hour, 9 am to 8 pm", () => {
    const h = heatmap([call(sat(12)), call(sat(12, 20)), call(sat(13)), call("2026-11-09T03:45:00Z"), call(sat(12), { direction: "outbound" }), call("2026-11-07T20:00:00Z") /* 1:30 am Sunday: outside the hours */, call("bad")]);
    expect(h.total).toBe(4);
    expect(h.grid[5][17 - 9]).toBe(2); // Saturday 5 pm
    expect(h.grid[5][18 - 9]).toBe(1); // Saturday 6 pm
    expect(h.grid[0][9 - 9]).toBe(1); // Monday 9:15 am
    expect(h.max).toBe(2);
  });
  it("finds the best two hours in a row on the best weekday", () => {
    const h = heatmap([call(sat(12)), call(sat(12, 20)), call(sat(13)), call("2026-11-09T03:45:00Z")]);
    expect(h.busiest).toEqual({ weekday: 5, fromHour: 17, toHour: 19 });
  });
  it("nothing counted: no busiest time", () => {
    expect(heatmap([])).toMatchObject({ total: 0, max: 0, busiest: null });
  });
});
