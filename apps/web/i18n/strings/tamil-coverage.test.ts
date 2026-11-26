import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import legal from "@/i18n/strings/legal.json";
import site from "@/i18n/strings/site.json";
import { LEGAL_ENGLISH_ONLY_TA } from "@/lib/legal/documents";

/**
 * Tamil on the public website (owner, 20 Nov 2026). A site string that some page reads has a Tamil text (a draft for a native reader: TAMIL-DRAFT.md); a string that no source file reads any more (the words of older versions of the home
 * page) has none and would show its English if it ever came back, so this test names which is which: add the Tamil text of a key the day a page starts reading it. The legal words have none (owner-gated: no Tamil legal text ships).
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
// (every quoted key-shaped word of the source, collected ONCE: a lookup per key instead of three searches through the whole source for each of the thousand keys, which took 6 s)
const literals = new Set([...code.matchAll(/[`"']([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)[`"']/g)].map((m) => m[1]));
const familyList = [...families];
const isRead = (key: string): boolean => literals.has(key) || familyList.some((f) => key.startsWith(f));

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
  it("no legal word has one (owner-gated: no Tamil legal text ships; a Tamil visitor reads the legal words in English, plus the one Tamil line of LEGAL_ENGLISH_ONLY_TA)", () => {
    expect(Object.entries(legal as Record<string, { ta?: string; status: Record<string, string> }>).filter(([, e]) => e.ta !== undefined || "ta" in e.status).map(([k]) => k)).toEqual([]);
    expect(LEGAL_ENGLISH_ONLY_TA).toBe("இந்தப் பக்கம் ஆங்கிலத்தில் உள்ளது");
  });
  it("the home page's description names the product's four languages in every site language (and Tamil is not one of them)", () => {
    const d = (site as unknown as Record<string, Record<string, string>>)["meta.description"];
    expect(d.en).toMatch(/Telugu, English, Hindi and Kannada/);
    // (26 Nov 2026: the four language names are written in each language's own script now)
    expect(d.te).toMatch(/తెలుగు.*ఇంగ్లీష్.*హిందీ.*కన్నడ/);
    expect(d.hi).toMatch(/तेलुगु.*अंग्रेज़ी.*हिन्दी.*कन्नड़/);
    expect(d.kn).toMatch(/ತೆಲುಗು.*ಇಂಗ್ಲಿಷ್.*ಹಿಂದಿ.*ಕನ್ನಡ/);
    expect(d.ta).toMatch(/தெலுங்கு, ஆங்கிலம், இந்தி, கன்னடம்/);
    for (const l of ["en", "te", "hi", "kn", "ta"]) expect(d[l], l).not.toMatch(/Tamil|தமிழ்/);
  });
});
