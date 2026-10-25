// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MATERIAL_SENTENCES, withMaterialWords } from "./material-words";

const dictionary = JSON.parse(readFileSync(new URL("../../i18n/strings/app.json", import.meta.url), "utf8")) as Record<string, { en: string; te: string; hi: string; kn: string }>;

describe("the building-materials sentences (job DG)", () => {
  it("replace the textile sentences, key by key, and nothing else", () => {
    const words = { "enq.approving_needs_a_saree_type_and": "saree", "mat.req.approving_needs": "product", "enq.other": "same" };
    expect(withMaterialWords(words)).toEqual({ ...words, "enq.approving_needs_a_saree_type_and": "product" });
  });
  it("hand back the same object when the page holds no materials sentence (a business without the module keeps every word)", () => {
    const words = { "enq.approving_needs_a_saree_type_and": "saree" };
    expect(withMaterialWords(words)).toBe(words);
  });
  it("name only sentences that exist in all four languages and say nothing about sarees or fabric", () => {
    for (const [shared, own] of Object.entries(MATERIAL_SENTENCES)) {
      expect(dictionary[shared], shared).toBeDefined();
      for (const lang of ["en", "te", "hi", "kn"] as const) {
        const text = dictionary[own]?.[lang];
        expect(text, `${own} ${lang}`).toBeTruthy();
        expect(text, `${own} ${lang}`).not.toMatch(/saree|sari|fabric|colour|చీర|साड़ी|ಸೀರೆ/i);
      }
    }
  });
});
