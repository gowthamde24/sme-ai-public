import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** The status chips of the wallet screen (design/billing.css): solid, WCAG AA in both themes, scoped to the screen's own attribute. */
const css = readFileSync(path.resolve(import.meta.dirname, "billing.css"), "utf8");

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

describe.each([
  ["light", '[data-ui="v2"] [data-bill="2"]'],
  ["dark", '[data-ui="v2"][data-theme="dark"] [data-bill="2"]'],
  ["dark by the system", '  [data-ui="v2"]:not([data-theme="light"]) [data-bill="2"]'],
])("the wallet's status chips, %s", (_name, selector) => {
  const t = block(selector);
  it.each(["done", "wait", "fail", "info"])("%s: its word on its own fill is at least 4.5:1", (tone) => {
    expect(ratio(t.get(`--bl-${tone}-fg`) as string, t.get(`--bl-${tone}-bg`) as string), tone).toBeGreaterThanOrEqual(4.5);
  });
  it("the four fills are four different colours", () => {
    expect(new Set(["done", "wait", "fail", "info"].map((k) => t.get(`--bl-${k}-bg`))).size).toBe(4);
  });
});

describe("the stylesheet", () => {
  it("only reaches inside the screen's own [data-bill] and animates nothing", () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = bare.split("\n").filter((l) => l.includes("{") && !l.trim().startsWith("@")).map((l) => l.slice(0, l.indexOf("{")).trim());
    expect(selectors.length).toBeGreaterThan(8);
    for (const s of selectors) expect(s, s).toContain('[data-bill="2"]');
    expect(bare).not.toMatch(/transition|animation/);
  });
});
