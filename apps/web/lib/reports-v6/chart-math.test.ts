import { describe, expect, it } from "vitest";

import { areaPath, donutSegments, heatLevel, nearestIndex, niceScale, runningTotal, seriesPoints, smoothPath } from "./chart-math";

describe("a scale", () => {
  it("steps of 1, 2 or 5 times a power of ten, three to five lines, the top above the largest value", () => {
    expect(niceScale(16)).toEqual({ top: 20, ticks: [0, 5, 10, 15, 20] });
    expect(niceScale(6)).toEqual({ top: 6, ticks: [0, 2, 4, 6] });
    expect(niceScale(240_000).top).toBe(300_000);
    expect(niceScale(1)).toEqual({ top: 3, ticks: [0, 1, 2, 3] });
    for (const m of [1, 3, 7, 16, 99, 1234]) {
      const s = niceScale(m);
      expect(s.top).toBeGreaterThanOrEqual(m);
      expect(s.ticks.length).toBeGreaterThanOrEqual(4);
      expect(s.ticks.length).toBeLessThanOrEqual(6);
    }
  });
  it("a series of zeros (or nothing) still has a scale", () => {
    expect(niceScale(0)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(Number.NaN).top).toBe(4);
  });
});

describe("the points and the smooth line", () => {
  const plot = { left: 0, right: 100, top: 0, bottom: 100 };
  it("spreads x evenly, puts the top of the scale at the top edge and zero on the baseline, and clamps", () => {
    expect(seriesPoints([0, 5, 10], plot, 10)).toEqual([{ x: 0, y: 100 }, { x: 50, y: 50 }, { x: 100, y: 0 }]);
    expect(seriesPoints([99], plot, 10)).toEqual([{ x: 50, y: 0 }]);
    expect(seriesPoints([-3], plot, 10)[0].y).toBe(100);
  });
  it("passes through every point with cubic curves", () => {
    const d = smoothPath([{ x: 0, y: 50 }, { x: 10, y: 20 }, { x: 20, y: 40 }]);
    expect(d.startsWith("M0,50 C")).toBe(true);
    expect(d.endsWith("20,40")).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(2);
  });
  it("never overshoots: between two equal points the line stays flat; a peak is not rounded above its point", () => {
    expect(smoothPath([{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 10 }])).not.toMatch(/NaN/);
    const peak = smoothPath([{ x: 0, y: 80 }, { x: 10, y: 20 }, { x: 20, y: 80 }]);
    const ys = [...peak.matchAll(/(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20); // y grows downward: nothing is drawn above the peak at 20
    expect(Math.max(...ys)).toBeLessThanOrEqual(80);
  });
  it("small cases: nothing, one point, two points", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 3, y: 4 }])).toBe("M3,4");
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe("M0,0 C3.3,3.3 6.7,6.7 10,10");
  });
  it("the area closes down to the baseline", () => {
    expect(areaPath([{ x: 0, y: 5 }, { x: 10, y: 5 }], 20)).toMatch(/ L10,20 L0,20 Z$/);
    expect(areaPath([{ x: 0, y: 5 }], 20)).toBe("");
  });
  it("finds the point nearest to the pointer", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    expect([nearestIndex(pts, -5), nearestIndex(pts, 6), nearestIndex(pts, 14), nearestIndex(pts, 99)]).toEqual([0, 1, 1, 2]);
    expect(nearestIndex([], 1)).toBe(-1);
  });
  it("a running total", () => {
    expect(runningTotal([0, 5, 0, 10])).toEqual([0, 5, 5, 15]);
    expect(runningTotal([])).toEqual([]);
  });
});

describe("the donut", () => {
  it("segments add up to the circle (less the gaps), clockwise from the top, none for a zero", () => {
    const c = 2 * Math.PI * 74;
    const s = donutSegments([31, 14, 9, 4, 0], 74);
    expect(s[4].dash).toBe(0);
    expect(s[0].offset).toBe(-0);
    expect(s[1].offset).toBeCloseTo(-(31 / 58) * c, 5);
    expect(s.slice(0, 4).reduce((t, x) => t + x.dash, 0) + 4 * 1.5).toBeCloseTo(c, 5);
  });
  it("one segment has no gap; nothing at all is empty", () => {
    expect(donutSegments([5], 10)[0].dash).toBeCloseTo(2 * Math.PI * 10, 5);
    expect(donutSegments([0, 0], 10).every((x) => x.dash === 0)).toBe(true);
  });
});

describe("a heatmap cell", () => {
  it("none = 0; the busiest = 5; the rest by share", () => {
    expect([0, 1, 4, 5, 9, 10].map((c) => heatLevel(c, 10))).toEqual([0, 1, 2, 3, 5, 5]);
    expect(heatLevel(3, 0)).toBe(0);
    expect(heatLevel(-1, 10)).toBe(0);
  });
});
