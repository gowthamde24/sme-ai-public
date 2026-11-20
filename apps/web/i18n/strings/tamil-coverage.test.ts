import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import legal from "@/i18n/strings/legal.json";
import site from "@/i18n/strings/site.json";

/**
 * Tamil on the public website (owner, 20 Nov 2026). A site string that some page reads has a Tamil text (a draft for a native reader: TAMIL-DRAFT.md); a string that no source file reads any more (the words of older versions of the home
 * page) has none and would show its English if it ever came back, so this test names which is which: add the Tamil text of a key the day a page starts reading it. The legal words (the notice, the cookie panel, the legal pages' headings) all have one.
 * The product speaks Telugu, English, Hindi and Kannada: no Tamil string says otherwise (SitePage.test.tsx).
 */
const entries = site as Record<string, { en: string; ta?: string; status: Record<string, string> }>;
const ROOTS = ["app", "components", "lib", "i18n"];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : sources(full);
    return /\.tsx?$/.test(e.name) && !/\.(test|d)\./.test(e.name) ? [full] : [];
  });
}
const code = ROOTS.flatMap((r) => sources(path.join(process.cwd(), r))).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const families = new Set([...code.matchAll(/[`"']([a-z0-9]+(?:\.[a-z0-9_]+)*\.)\$\{/g)].map((m) => m[1]));
const isRead = (key: string): boolean => code.includes(`"${key}"`) || code.includes(`'${key}'`) || code.includes(`\`${key}\``) || [...families].some((f) => key.startsWith(f));

describe("Tamil words of the public site", () => {
  it("every site string a page reads has a Tamil text, marked draft", () => {
    const missing = Object.keys(entries).filter((k) => isRead(k) && entries[k].ta === undefined);
    expect(missing).toEqual([]);
    for (const [k, e] of Object.entries(entries)) if (e.ta !== undefined && !(e as { only?: string[] }).only) expect(e.status.ta, k).toBe("draft");
  });
  it("a string without a Tamil text is one no page reads (so no visitor sees English where Tamil should be)", () => {
    const orphan = Object.keys(entries).filter((k) => entries[k].ta === undefined);
    expect(orphan.length).toBeGreaterThan(300); // (the older versions of the home page)
    expect(orphan.filter(isRead)).toEqual([]);
  });
  it("every legal word has one", () => {
    expect(Object.entries(legal as Record<string, { ta?: string }>).filter(([, e]) => e.ta === undefined).map(([k]) => k)).toEqual([]);
  });
});
