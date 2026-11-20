import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ONE FACE (owner, 21 Nov 2026: "change font inside website also"): the whole product, the public site and the signed-in app, draws in Plus Jakarta Sans (with the Noto script fonts behind it). The old display face (Bricolage Grotesque) is gone: this fails if a CSS or source file names it,
 * if `--v2-font-display` (the variable its loader used to set) is read anywhere, or if the display stack is anything but the sans stack. The `font-display` utility and `--v2-font-display-stack` stay (hundreds of headings use the class) and resolve to the sans stack.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "indic-fonts", "public"]);
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : files(full);
    return /\.(css|tsx?|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}
const sources = ["app", "components", "design", "lib"].flatMap((d) => files(path.join(ROOT, d)));
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("the product draws in one face", () => {
  it("no source or style names the old display face", () => {
    const named = sources.filter((f) => /Bricolage/i.test(read(f))).map((f) => path.relative(ROOT, f));
    expect(named).toEqual([]);
  });
  it("nothing reads `--v2-font-display` (the variable of the old loader); only the -stack alias remains", () => {
    const reads = sources.filter((f) => /--v2-font-display(?!-stack)/.test(read(f))).map((f) => path.relative(ROOT, f));
    expect(reads).toEqual([]);
  });
  it("the display stack IS the sans stack, and the font loader loads Plus Jakarta Sans as its only Latin face", () => {
    const tokens = read(path.join(ROOT, "design/tokens.css"));
    expect(tokens).toMatch(/--v2-font-display-stack:\s*var\(--v2-font-sans-stack\);/);
    expect(read(path.join(ROOT, "design/v2.css"))).toMatch(/--font-display:\s*var\(--v2-font-display-stack\);/);
    const loader = read(path.join(ROOT, "design/fonts.ts"));
    expect(loader).toMatch(/import \{ Plus_Jakarta_Sans \} from "next\/font\/google";/);
    expect(loader).not.toMatch(/Grotesque|Bricolage/);
  });
  it("no stylesheet sets a heading in a face of its own", () => {
    const css = sources.filter((f) => f.endsWith(".css") && !f.includes("/staff/")).map((f) => [path.relative(ROOT, f), read(f)] as const);
    const odd = css.flatMap(([f, text]) => [...text.matchAll(/font-family:\s*([^;}]+)/g)].filter((m) => !/var\(--v2-font-(sans|display)-stack\)|inherit|-apple-system|system-ui|ui-monospace|monospace|sans-serif/.test(m[1])).map((m) => `${f}: ${m[1].trim()}`));
    expect(odd).toEqual([]);
  });
});
