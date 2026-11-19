import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** The status chip and the status area of the Chats composer queue (design/chat-queue.css): AA in both themes, no dependence on JOBS, one reserved height, only transform and opacity animate. */
const css = readFileSync(path.resolve(import.meta.dirname, "chat-queue.css"), "utf8");
const v2 = readFileSync(path.resolve(import.meta.dirname, "v2.css"), "utf8");
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
  ["light", block('[data-ui="v2"]')],
  ["dark", block('[data-ui="v2"][data-theme="dark"]')],
  ["dark by the system", block('  [data-ui="v2"]:not([data-theme="light"])')],
])("the queue chips, %s", (_n, t) => {
  it.each(["done", "wait", "fail", "info"])("%s: word on fill at least 4.5:1", (tone) => {
    expect(ratio(t.get(`--cq-${tone}-fg`) as string, t.get(`--cq-${tone}-bg`) as string)).toBeGreaterThanOrEqual(4.5);
  });
});
describe("the stylesheet", () => {
  it("is imported by the one entry stylesheet and does not need JOBS", () => {
    expect(v2).toContain('@import "./chat-queue.css";');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("data-jobs");
  });
  it("reserves ONE height for the status area (a phone and a wide screen), and animates only transform and opacity", () => {
    expect(css).toMatch(/\[data-part="queue-status"\] \{ min-height: 9\.75rem; \}/);
    expect(css).toMatch(/min-width: 640px\)[\s\S]*queue-status"\] \{ min-height: 8\.25rem; \}/);
    const key = css.match(/@keyframes cq-in\s*\{([\s\S]*?\n\})/)?.[1] ?? "";
    expect(key).toMatch(/opacity/);
    expect(key).not.toMatch(/\b(width|height|margin|padding|top|left|background|color)\s*:/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });
});
