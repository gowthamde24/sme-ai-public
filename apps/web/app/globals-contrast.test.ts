// @vitest-environment node
/** Link and text colours meet WCAG AA (4.5:1) on the page background in both themes. jsdom cannot paint, so this reads the colour tokens out of globals.css and does the arithmetic. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");

const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))));
const darkStart = css.indexOf("@media (prefers-color-scheme: dark) {");
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf("}", css.indexOf(":root {", darkStart)))) };

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s theme", (_name, t) => {
  it.each(["link", "link-visited", "fg", "muted"])("%s text is at least 4.5:1 on the background", (token) => {
    expect(t[token], token).toBeDefined();
    expect(ratio(t[token], t.bg), token).toBeGreaterThanOrEqual(4.5);
  });
});

describe("links", () => {
  it("take their colour from the tokens at the root, and the browser's default blue is not used", () => {
    expect(css).toMatch(/\na \{\s*color: var\(--link\);/);
    expect(css).toMatch(/\na:visited \{\s*color: var\(--link-visited\);/);
    expect(ratio("#0000ee", dark.bg)).toBeLessThan(4.5); // what the owner saw
  });
  it("the button-looking link and the current tab keep their own colour (their rules come later or are more specific)", () => {
    expect(css.indexOf("a.button {")).toBeGreaterThan(css.indexOf("a:visited {"));
    expect(css).toMatch(/\.tabs a\[aria-current="page"\] \{[^}]*color: var\(--fg\)/);
  });
});
