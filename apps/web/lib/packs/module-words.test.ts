import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";

import { withModuleWords } from "./module-words";

describe("words by module", () => {
  const words = { "a.b": "saree", "a.b@materials": "product", "c.d": "same", "x.y@materials": "no base key" };
  it("a variant replaces the plain word for a business type with that module", () => {
    expect(withModuleWords(words, { modules: ["today", "materials"] })["a.b"]).toBe("product");
  });
  it("no pack, or a pack without the module: the plain word", () => {
    expect(withModuleWords(words, null)).toBe(words);
    expect(withModuleWords(words, { modules: ["today"] })).toBe(words);
  });
  it("a variant with no plain word to replace is ignored, and other words are untouched", () => {
    const out = withModuleWords(words, { modules: ["materials"] });
    expect(out["c.d"]).toBe("same");
    expect("x.y" in out).toBe(false);
  });
  it("every variant in the string store replaces a word that exists, in every language, and keeps the same placeholders", () => {
    for (const lang of LANGS) {
      const dict = appDict(lang) as Record<string, string>;
      const en = appDict("en") as Record<string, string>;
      for (const key of Object.keys(dict).filter((k) => k.includes("@"))) {
        const base = key.slice(0, key.lastIndexOf("@"));
        expect(base in dict, `${lang}: ${key} has no word to replace`).toBe(true);
        const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(ph(dict[key]), `${lang}:${key}`).toEqual(ph(en[base]));
      }
    }
  });
});
