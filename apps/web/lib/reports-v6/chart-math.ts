/**
 * The arithmetic of the Reports charts (approved mock), pure so it is tested without a browser: a "nice" top and ticks for a scale, the smooth line through the points of a day-by-day series (a monotone curve, so it never dips below the points around it), the filled area under
 * it, the segments of a donut and the shade of a heatmap cell. No chart library: the pages draw these numbers as plain SVG and CSS.
 */
export type Pt = { x: number; y: number };

/** A top and ticks for 0..max: the step is 1, 2 or 5 times a power of ten, with 3 to 5 lines; a series of zeros still gets a scale (0 to 4); never a step below 1. */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw); // whole numbers: a count or paise never needs a step below 1
  const top = Math.max(step * 3, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

/** The points of a series across a plot: `x` spread evenly from left to right, `y` scaled so `top` is at the top edge. One point sits in the middle. */
export function seriesPoints(values: readonly number[], plot: { left: number; right: number; top: number; bottom: number }, scaleTop: number): Pt[] {
  const n = values.length;
  return values.map((v, i) => ({
    x: n === 1 ? (plot.left + plot.right) / 2 : plot.left + ((plot.right - plot.left) * i) / (n - 1),
    y: plot.bottom - ((plot.bottom - plot.top) * Math.min(Math.max(v, 0), scaleTop)) / scaleTop,
  }));
}

/** The smooth line through the points (a monotone cubic, the "C" curves of the mock): it passes through every point and has no overshoot. One point: nothing to draw; two: a straight line. */
export function smoothPath(pts: readonly Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    slope.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) d += ` C${f(pts[i].x + dx[i] / 3)},${f(pts[i].y + (m[i] * dx[i]) / 3)} ${f(pts[i + 1].x - dx[i] / 3)},${f(pts[i + 1].y - (m[i + 1] * dx[i]) / 3)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  return d;
}

/** The area under a smooth line down to the baseline (closed, for the gradient fill that fades out). */
export function areaPath(pts: readonly Pt[], baseline: number): string {
  if (pts.length < 2) return "";
  return `${smoothPath(pts)} L${f(pts[pts.length - 1].x)},${f(baseline)} L${f(pts[0].x)},${f(baseline)} Z`;
}

/** The nearest point (by x) to a pointer position; -1 when there are no points. */
export function nearestIndex(pts: readonly Pt[], x: number): number {
  let best = -1;
  let gap = Infinity;
  pts.forEach((p, i) => {
    const g = Math.abs(p.x - x);
    if (g < gap) {
      gap = g;
      best = i;
    }
  });
  return best;
}

/** The running total of a series ("sales this period"). */
export function runningTotal(values: readonly number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += v));
}

/** The segments of a donut as stroke dashes on a circle of radius `r` (start at the top, clockwise): `dash` is the length drawn and `offset` where it starts. Values at or below zero have no segment. A tiny gap keeps neighbours apart. */
export function donutSegments(values: readonly number[], r: number, gap = 1.5): { dash: number; rest: number; offset: number }[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const c = 2 * Math.PI * r;
  let used = 0;
  return values.map((v) => {
    if (total === 0 || v <= 0) return { dash: 0, rest: c, offset: 0 };
    const len = (v / total) * c;
    const seg = { dash: Math.max(0, len - (values.filter((x) => x > 0).length > 1 ? gap : 0)), rest: c, offset: -used };
    used += len;
    return seg;
  });
}

/** The shade of a heatmap cell, 0 (nothing) to 5 (the busiest), from its share of the busiest cell. */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!(count > 0) || !(max > 0)) return 0;
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5))) as 1 | 2 | 3 | 4 | 5;
}
