import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * DESKTOP DENSITY (owner 19 Nov 2026): the desktop scale as tokens in design/ds.css. The file is read as text, so the tokens, their scope and their breakpoint are checked without a browser.
 * The tokens exist once, inside `@layer theme` (so they can use !important against Tailwind's important utilities) and inside `@media (min-width: 1024px)`, scoped to the v2 root with the design system on. The phone's tokens are unchanged.
 */
const css = readFileSync(path.resolve(import.meta.dirname, "ds.css"), "utf8");
const START = css.indexOf("DESKTOP DENSITY (owner");
const END = css.indexOf("/* ---- Reports (design system v6, c2/ds-reports-v2)");
const section = css.slice(START, END);
const ROOT = '[data-ui="v2"][data-ds="6"]';

/** The text of the first balanced {...} block that starts at `open` (the index of its `{`). */
function braces(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced braces");
}
const layer = braces(section, section.indexOf("@layer theme {") + "@layer theme ".length);
const media = braces(layer, layer.indexOf("@media (min-width: 1024px)") + "@media (min-width: 1024px) ".length);
const tokenBlock = braces(media, media.indexOf(`${ROOT} {`) + `${ROOT} `.length);

const TOKENS: Record<string, string> = {
  "--dk-body": "14px",
  "--dk-help": "13px",
  "--dk-label": "11px",
  "--dk-title": "24px",
  "--dk-card-title": "16px",
  "--dk-stat": "22px",
  "--dk-ctl-h": "34px",
  "--dk-row-h": "44px",
  "--dk-pad-page": "28px",
  "--dk-pad-card": "16px",
  "--dk-gap": "12px",
  "--dk-side-w": "232px",
  "--dk-side-row": "34px",
};
const px = (name: string): number => {
  const m = tokenBlock.match(new RegExp(`${name}:\\s*(\\d+)px`));
  expect(m, name).not.toBeNull();
  return Number(m?.[1]);
};

describe("the desktop tokens", () => {
  it("are defined once, with the owner's numbers", () => {
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(tokenBlock, name).toContain(`${name}: ${value};`);
      expect(css.split(`${name}:`).length - 1, `${name} is defined once`).toBe(1);
    }
  });
  it("stay inside the owner's ranges", () => {
    expect(px("--dk-body")).toBe(14);
    expect(px("--dk-help")).toBeGreaterThanOrEqual(12);
    expect(px("--dk-help")).toBeLessThanOrEqual(13);
    expect(px("--dk-label")).toBe(11);
    expect(px("--dk-title")).toBeGreaterThanOrEqual(22);
    expect(px("--dk-title")).toBeLessThanOrEqual(24);
    expect(px("--dk-card-title")).toBeGreaterThanOrEqual(15);
    expect(px("--dk-card-title")).toBeLessThanOrEqual(16);
    expect(px("--dk-stat")).toBeGreaterThanOrEqual(20);
    expect(px("--dk-stat")).toBeLessThanOrEqual(22);
    expect(px("--dk-ctl-h")).toBeGreaterThanOrEqual(32);
    expect(px("--dk-ctl-h")).toBeLessThanOrEqual(36);
    expect(px("--dk-icon-btn")).toBe(32);
    expect(px("--dk-row-h")).toBeGreaterThanOrEqual(40);
    expect(px("--dk-row-h")).toBeLessThanOrEqual(48);
    expect(px("--dk-pad-page")).toBeGreaterThanOrEqual(24);
    expect(px("--dk-pad-page")).toBeLessThanOrEqual(32);
    expect(px("--dk-pad-card")).toBeGreaterThanOrEqual(14);
    expect(px("--dk-pad-card")).toBeLessThanOrEqual(16);
    expect(px("--dk-gap")).toBeGreaterThanOrEqual(8);
    expect(px("--dk-gap")).toBeLessThanOrEqual(12);
    expect(px("--dk-side-w")).toBeGreaterThanOrEqual(220);
    expect(px("--dk-side-w")).toBeLessThanOrEqual(240);
    expect(px("--dk-side-row")).toBeGreaterThanOrEqual(32);
    expect(px("--dk-side-row")).toBeLessThanOrEqual(36);
  });
});

describe("the scope", () => {
  it("everything sits in @layer theme (it beats Tailwind's important utilities) and in the 1024px desktop media query, and the layer holds nothing else of the section", () => {
    expect(layer).toContain("@media (min-width: 1024px)");
    // the section has exactly one @layer and one @media, and no `max-width` (nothing reaches the phone)
    expect(section.match(/@layer /g)).toHaveLength(1);
    expect(section.match(/@media /g)).toHaveLength(1);
    expect(section).not.toContain("max-width");
  });
  it("every rule is scoped to the v2 root with the design system on", () => {
    const rules = media.split("\n").filter((l) => l.trim().startsWith("[") || l.includes("{"));
    expect(rules.length).toBeGreaterThan(40);
    for (const l of rules) {
      const t = l.trim();
      if (t.startsWith("/*") || t.startsWith("--")) continue;
      expect(t.startsWith(ROOT), t.slice(0, 80)).toBe(true);
    }
  });
  it("every declaration of a rule beats the utilities: !important (a token or a custom property is exempt)", () => {
    for (const l of media.split("\n")) {
      const t = l.trim();
      const m = t.match(/\{(.*)\}\s*$/);
      if (!m || t.startsWith("/*")) continue;
      for (const decl of m[1].split(";").map((d) => d.trim()).filter(Boolean)) {
        if (decl.startsWith("--")) continue;
        // `height` of a table row has no utility to beat
        if (decl.startsWith("height: var(--dk-row-h)")) continue;
        expect(decl, t.slice(0, 80)).toContain("!important");
      }
    }
  });
  it("reaches the screens through the shared parts: the page, the menu, the top bar, the controls, the cards, the tables", () => {
    for (const part of ["main {", "main h1", "main :is(h2, h3)", '[data-frame="app"] > aside', "[data-nav-row]", "header.sticky", "min-h-11", "size-11", "rounded-", "td, th", ".ds-hero"]) {
      expect(media, part).toContain(part);
    }
    // the side menu's width is set on the app frame's menu only, not on every <aside> of a page
    expect(media).not.toMatch(/\] aside \{/);
  });
  it("capitals for the 11px labels never reach Indic scripts, and Indic text keeps its size", () => {
    expect(media).toContain(":not(:lang(te)):not(:lang(hi)):not(:lang(kn))");
  });
  it("never touches a colour, an outline or a focus ring", () => {
    expect(section).not.toMatch(/(^|[;{\s])(color|background|background-color|border-color|outline|outline-offset|box-shadow):/m);
    expect(section).not.toContain("focus");
  });
});

describe("the phone and the tablet keep their own sizes", () => {
  it("the phone's tokens are exactly as they were (PHONE DENSITY v2)", () => {
    const start = css.indexOf("PHONE DENSITY v2");
    const own = braces(css.slice(start), css.slice(start).indexOf("@layer theme {") + "@layer theme ".length);
    const ph = braces(own, own.indexOf("@media (max-width: 767px)") + "@media (max-width: 767px) ".length);
    const tokens = braces(ph, ph.indexOf(`${ROOT} {`) + `${ROOT} `.length)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(tokens).toEqual(["--ph-title: 24px;", "--ph-card-title: 16px;", "--ph-btn: 2.5rem;"]);
    // the phone's 44px tap area (a 40px button with a 2px halo) and its body size
    expect(css).toContain("inset: -2px 0");
    expect(css).toContain('main { font-size: 14px !important; }');
  });
  it("no desktop token is used by a rule of the phone or the tablet", () => {
    const outside = css.slice(0, START) + css.slice(END);
    expect(outside).not.toContain("--dk-");
  });
  it("the desktop section starts at 1024px, the menu's own `lg` (the tablet, 768 to 1023, keeps the 256px menu)", () => {
    expect(section).toContain("(min-width: 1024px)");
    expect(section).not.toContain("min-width: 768px");
  });
});
