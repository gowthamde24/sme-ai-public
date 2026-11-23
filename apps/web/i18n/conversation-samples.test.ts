import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";

/** The sample calls under "How it talks" (owner, 24 Nov 2026: real two-sided conversations): four turns, customer first, the same four in every language, no demo markers, no prices, no invented numbers. */
const entries = Object.entries(app as unknown as Record<string, Record<string, string>>).filter(([k]) => /^vc\.cv\.[a-z_]+\.(friendly|respectful|quick)$/.test(k));
describe("sample calls", () => {
  it("every business type has the three tones, and a default exists", () => {
    const types = new Set(entries.map(([k]) => k.split(".")[2]));
    expect(types.has("default")).toBe(true);
    expect(types.size).toBeGreaterThanOrEqual(6);
    for (const t of types) for (const tone of ["friendly", "respectful", "quick"]) expect(app as unknown as Record<string, unknown>, `${t}.${tone}`).toHaveProperty([`vc.cv.${t}.${tone}`]);
  });
  it.each(entries)("%s: four non-empty turns in every language", (_k, e) => {
    for (const l of ["en", "te", "hi", "kn"]) {
      const turns = e[l].split("\n");
      expect(turns, l).toHaveLength(4);
      for (const line of turns) expect(line.trim().length, l).toBeGreaterThan(1);
    }
  });
  it("no demo marker, no rupee amount, no AI wording in the English lines", () => {
    for (const [k, e] of entries) {
      expect(e.en, k).not.toMatch(/\(demo\)|\(synthetic\)|₹|\bAI\b|assistant/i);
    }
  });
});
