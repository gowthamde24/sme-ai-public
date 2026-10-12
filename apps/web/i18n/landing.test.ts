import { describe, expect, it } from "vitest";

import { BRAND_TEXT } from "@/design/brand";
import { LANGS } from "@/i18n/lang";
import { landingDict, landingT } from "@/i18n/landing";

describe("landing dictionary", () => {
  it("has the same keys in every language", () => {
    const keys = Object.keys(landingDict("en"));
    expect(keys.length).toBeGreaterThan(100);
    for (const l of LANGS) expect(Object.keys(landingDict(l))).toEqual(keys);
  });
  it("t() fills the brand, the year and variables", () => {
    const t = landingT("en");
    expect(t("meta.title")).toContain(BRAND_TEXT);
    expect(t("foot.copy")).toBe(`© ${new Date().getFullYear()} ${BRAND_TEXT}`);
    expect(t("price.shop.p")).toContain("[PRICE]"); // a plain placeholder: the price is not decided, and a bracket is not a variable
  });
  it("gives a different text per language for a heading", () => {
    const hero = LANGS.map((l) => landingDict(l)["hero.h1"]);
    expect(new Set(hero).size).toBe(4);
  });
});
