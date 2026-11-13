import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The colours of the design system v6 (design/ds.css) keep WCAG AA in both themes: text on its own background >= 4.5:1, every control edge on the page >= 3:1. The file is read as text (one colour per line), so a change to a colour is checked here without a browser.
 */
const css = readFileSync(path.resolve(import.meta.dirname, "ds.css"), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}
const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const LIGHT = block('[data-ui="v2"][data-ds="6"]');
const DARK = block('[data-ui="v2"][data-ds="6"][data-theme="dark"]');
const MEDIA = block('  [data-ui="v2"][data-ds="6"]:not([data-theme="light"])');
const STATUSES = ["completed", "transferred", "noanswer", "rejected", "spam", "live"];

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("design system v6, %s", (_name, t) => {
  const get = (k: string) => t.get(k) as string;
  it("body text, muted text and the orange text on the page and on a card", () => {
    for (const bg of ["--v2-bg", "--v2-surface", "--v2-surface-2"]) {
      expect(ratio(get("--v2-ink"), get(bg)), `ink on ${bg}`).toBeGreaterThanOrEqual(7);
      expect(ratio(get("--v2-muted"), get(bg)), `muted on ${bg}`).toBeGreaterThanOrEqual(5);
      expect(ratio(get("--v2-brand-text"), get(bg)), `brand text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(get("--v2-brand-text"), get("--v2-brand-bg"))).toBeGreaterThanOrEqual(4.5);
  });
  it("the button: white on the brand orange; the edge of a control is seen on the page", () => {
    expect(ratio(get("--v2-on-brand"), get("--v2-brand"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(get("--v2-border-strong"), get("--v2-bg"))).toBeGreaterThanOrEqual(3);
    expect(ratio(get("--v2-border-strong"), get("--v2-surface"))).toBeGreaterThanOrEqual(3);
  });
  it.each(STATUSES)("the %s pill: its text on its own background", (s) => {
    expect(ratio(get(`--ds-st-${s}-text`), get(`--ds-st-${s}-bg`))).toBeGreaterThanOrEqual(4.5);
  });
  it("the six statuses are six different colours", () => {
    expect(new Set(STATUSES.map((s) => get(`--ds-st-${s}-text`))).size).toBe(6);
  });
});

describe("the dark block for 'no explicit choice' repeats the dark block, value for value", () => {
  it("is identical", () => {
    expect(MEDIA.size).toBe(DARK.size);
    for (const [k, v] of DARK) expect(MEDIA.get(k), k).toBe(v);
  });
});
