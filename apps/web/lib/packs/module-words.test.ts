import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";

import { withModuleT, withModuleWords } from "./module-words";

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

describe("a translation function by module (job CU)", () => {
  const dict = { "a.b": "saree", "a.b@materials": "product", "n.m": "{n} sarees", "n.m@materials": "{n} products", "c.d": "same" };
  const t = ((key: keyof typeof dict, vars?: { n: number }) => dict[key].replace("{n}", String(vars?.n ?? ""))) as unknown as (key: never, vars?: never) => string;
  it("answers the variant for a business type with the module, filled the way the plain one is", () => {
    const w = withModuleT(t, { modules: ["materials"] }, dict) as unknown as (k: string, v?: { n: number }) => string;
    expect(w("a.b")).toBe("product");
    expect(w("n.m", { n: 3 })).toBe("3 products");
    expect(w("c.d")).toBe("same");
  });
  it("no pack, or a pack without the module, or nothing to replace: the same function", () => {
    expect(withModuleT(t, null, dict)).toBe(t);
    expect(withModuleT(t, { modules: ["today"] }, dict)).toBe(t);
  });
  it("the real store: a school and a builder do not hear about sarees from your assistant", () => {
    const en = appDict("en") as Record<string, string>;
    const real = (modules: string[]) => withModuleT(((k: string) => en[k]) as never, { modules }, en) as unknown as (k: string) => string;
    expect(real(["today"])("ask.can.y3")).toMatch(/sarees/);
    expect(real(["materials"])("ask.can.y3")).not.toMatch(/saree/);
    expect(real(["programmes"])("ask.can.y2")).toMatch(/enquiry/);
    expect(real(["programmes"])("ask.can.n3")).toMatch(/child's record/);
  });
});
