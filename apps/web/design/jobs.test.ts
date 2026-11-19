import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Jobs design foundation (design/jobs.css, owner 19 Nov 2026): the solid status chips keep WCAG AA in both themes, everything is scoped to the flag, only transform and opacity are animated, and a person who asked for less motion gets none.
 */
const css = readFileSync(path.resolve(import.meta.dirname, "jobs.css"), "utf8");
const ds = readFileSync(path.resolve(import.meta.dirname, "ds.css"), "utf8");

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

const LIGHT = block('[data-ui="v2"][data-jobs="1"]');
const DARK = block('[data-ui="v2"][data-jobs="1"][data-theme="dark"]');
const MEDIA = block('  [data-ui="v2"][data-jobs="1"]:not([data-theme="light"])');

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
  ["dark by the system", MEDIA],
])("the solid status chips, %s", (_name, t) => {
  it.each(["done", "wait", "fail", "info"])("%s: its word on its own fill is at least 4.5:1", (tone) => {
    expect(ratio(t.get(`--jb-${tone}-fg`) as string, t.get(`--jb-${tone}-bg`) as string), tone).toBeGreaterThanOrEqual(4.5);
  });
  it("the four fills are four different colours", () => {
    expect(new Set(["done", "wait", "fail", "info"].map((k) => t.get(`--jb-${k}-bg`))).size).toBe(4);
  });
});

describe("the dark values by the system are the dark theme's, line for line", () => {
  it("same colours", () => {
    for (const k of ["done", "wait", "fail", "info"]) expect(MEDIA.get(`--jb-${k}-bg`)).toBe(DARK.get(`--jb-${k}-bg`));
  });
});

describe("scope and motion", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // [selector list, body] of every plain rule (at-rules and keyframe steps skipped)
  const plain = [...rules.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })).filter((r) => r.sel && !/^(from|to|\d+%(,\s*\d+%)*)$/.test(r.sel));
  it("every selector is under the flag or the loading marker: with JOBS off nothing applies", () => {
    expect(plain.length).toBeGreaterThan(20);
    for (const r of plain) for (const sel of r.sel.split(",").map((x) => x.trim())) expect(sel, sel).toMatch(/data-jobs="1"/);
  });
  it("only transform and opacity change over time (no width, height, margin, top, left, background in a transition or keyframe)", () => {
    for (const m of rules.matchAll(/transition:\s*([^;]+);/g)) expect(m[1].split(",").every((x) => /^\s*(transform|opacity)\b/.test(x)), m[0]).toBe(true);
    for (const m of rules.matchAll(/@keyframes [\w-]+\s*\{([\s\S]*?\n\})/g)) expect(m[1], m[0]).not.toMatch(/\b(width|height|margin|padding|top|left|right|bottom|background|color|box-shadow|filter)\s*:/);
  });
  it("every animation and transition sits behind prefers-reduced-motion: no-preference", () => {
    const outside = rules.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "");
    expect(outside).not.toMatch(/\banimation\s*:/);
    expect(outside).not.toMatch(/\btransition\s*:/);
  });
  it("the round tick boxes and radios are drawn round, with no square corner", () => {
    const boxes = plain.filter((r) => /input\[type="(checkbox|radio)"\](:|,|$)/.test(r.sel) && /border-radius/.test(r.body));
    expect(boxes.length).toBeGreaterThan(0);
    for (const r of boxes) expect(r.body, r.sel).toMatch(/border-radius:\s*50%/);
  });
  it("is imported with the other design files", () => {
    expect(readFileSync(path.resolve(import.meta.dirname, "v2.css"), "utf8")).toMatch(/@import "\.\/jobs\.css"/);
    expect(ds).not.toMatch(/data-jobs/);
  });
});
