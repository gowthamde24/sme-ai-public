import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";

import { INDUSTRY_PAGES, INDUSTRY_PRICING_LINE, industryBySlug } from "./industries";

const dict = appDict("en") as Record<string, string>;
const BANNED = /guarantee|best in|#1|number one|testimonial|customers love|thousands of|trusted by|\b\d{2,}%/i;

describe("the industry pages' data", () => {
  it("six pages with one honest headline, exactly three plain sections and a sample call of their business type", () => {
    expect(INDUSTRY_PAGES.map((p) => p.slug)).toEqual(["textiles", "clinics", "coaching", "real-estate", "car-dealers", "wholesale"]);
    for (const p of INDUSTRY_PAGES) {
      expect(p.headline.length).toBeGreaterThan(10);
      expect(p.sections).toHaveLength(3);
      const call = (dict[`vc.cv.${p.pack}.friendly`] ?? "").split("\n").filter(Boolean);
      expect(call, p.slug).toHaveLength(4);
      expect([...p.call], p.slug).toEqual(call); // the copy in the data is the app's own sample call
      expect(p.metaDescription.length).toBeLessThanOrEqual(170);
    }
  });
  it("no invented customer claims, numbers or superlatives anywhere in the copy; the only numbers are the plans'", () => {
    for (const p of INDUSTRY_PAGES) {
      const text = [p.headline, p.sub, p.metaTitle, p.metaDescription, ...p.sections.flatMap((s) => [s.title, s.text])].join(" ");
      expect(text, p.slug).not.toMatch(BANNED);
      expect(text.replace(/Stack19/g, ""), p.slug).not.toMatch(/\d/);
    }
    expect(INDUSTRY_PRICING_LINE).toContain("₹499");
    expect(INDUSTRY_PRICING_LINE).toContain("₹5 a minute");
  });
  it("finds a page by its address part and nothing else", () => {
    expect(industryBySlug("clinics")?.label).toBe("For clinics");
    expect(industryBySlug("unknown")).toBeNull();
  });
});
