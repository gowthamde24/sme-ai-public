import { describe, expect, it } from "vitest";

import { BRAND_TEXT } from "@/design/brand";
import { LANGS } from "@/i18n/lang";
import { landingDict, landingT } from "@/i18n/landing";

describe("landing dictionary", () => {
  it("has the same 137 keys in every language", () => {
    const keys = Object.keys(landingDict("en"));
    expect(keys).toHaveLength(137);
    for (const l of LANGS) expect(Object.keys(landingDict(l))).toEqual(keys);
  });
  it("t() fills the brand, the year and variables", () => {
    const t = landingT("en");
    expect(t("meta.title")).toContain(BRAND_TEXT);
    expect(t("foot.copy")).toBe(`© ${new Date().getFullYear()} ${BRAND_TEXT}`);
    expect(t("card.quote.t", { amount: "₹1" })).toContain("₹1");
  });
  it("gives a different text per language for a heading", () => {
    const hero = LANGS.map((l) => landingDict(l)["hero.h1"]);
    expect(new Set(hero).size).toBe(4);
  });
});
