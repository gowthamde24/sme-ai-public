// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The staff console is its own area with its own small token block (app/staff/staff.css): NO colour is written anywhere else (not in a component, not in a rule below the block), and nothing of it reaches the shop app (every rule is scoped to
 * [data-staff] or a .sc-* class). Internal screens may name providers; the shop app's strings and components may not carry the console's words.
 */
const WEB = path.resolve(import.meta.dirname, "../..");
const css = readFileSync(path.join(WEB, "app/staff/staff.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const HEX = /#[0-9a-fA-F]{3,8}\b/;

describe("the console's colours", () => {
  it("are written in ONE block, the tokens; every other rule uses var(--sc-...)", () => {
    const start = css.indexOf("[data-staff] {");
    const end = css.indexOf("\n}", start);
    const outside = css.slice(0, start) + css.slice(end);
    expect(outside).not.toMatch(HEX);
    expect(outside).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css.slice(start, end)).toMatch(HEX);
  });
  it("no component or page of the console writes a colour or a Tailwind arbitrary value", () => {
    const dirs = [path.join(WEB, "components/v2/app/staff"), path.join(WEB, "app/staff"), path.join(WEB, "lib/staff")];
    const files = dirs.flatMap((d) => (function walk(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) && !e.name.endsWith("staff.css") ? [path.join(dir, e.name)] : [])); })(d));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text.replace(/&#\d+;/g, ""), f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(text, f).not.toMatch(/className=\{?["'`][^"'`]*\[[^\]]*\]/);
    }
  });
  it("every selector is scoped to the console", () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "").split("{").slice(0, -1).map((chunk) => chunk.split("}").pop()!.trim()).filter((s) => s && !s.startsWith("@") && !/^(from|to)$/.test(s));
    for (const s of selectors.flatMap((x) => x.split(","))) expect(/\[data-staff\]|\.sc-|^\s*(from|to)\s*$/.test(s), s).toBe(true);
  });
  it("respects reduced motion: animations only inside prefers-reduced-motion: no-preference", () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "");
    expect(outside).not.toMatch(/animation\s*:|transition\s*:/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference/);
  });
});

describe("the console takes no part in the shop app's translation", () => {
  it("has no entry in the shop app's strings", () => {
    const strings = readFileSync(path.join(WEB, "i18n/strings/app.json"), "utf8");
    expect(strings).not.toMatch(/Staff console|staff\.console|Support view/);
  });
});
