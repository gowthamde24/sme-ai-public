import { describe, expect, it } from "vitest";

import { BRAND_NAME, BRAND_TEXT } from "@/design/brand";
import { fill, fillPlain } from "@/i18n/fill";

describe("fill", () => {
  it("injects the brand (with the joiner), the year and variables, and leaves unknown placeholders visible", () => {
    expect(fill("{brand} ©{year}")).toBe(`${BRAND_TEXT} ©${new Date().getFullYear()}`);
    expect(fill("Total {amount}", { amount: "₹5" })).toBe("Total ₹5");
    expect(fill("Hi {who}")).toBe("Hi {who}");
  });
  it("fillPlain gives the plain name and no joiner anywhere", () => {
    expect(fillPlain("{brand}: orders")).toBe(`${BRAND_NAME}: orders`);
    expect(fillPlain("फ़ॉलो-⁠अप")).toBe("फ़ॉलो-अप");
  });
});
