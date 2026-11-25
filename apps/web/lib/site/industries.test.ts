import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";

import { INDUSTRY_PAGES, INDUSTRY_PRICING_LINE, industryBySlug } from "./industries";

const dict = appDict("en") as Record<string, string>;
const BANNED = /guarantee|best in|#1|number one|testimonial|customers love|thousands of|trusted by|\b\d{2,}%/i;

describe("the industry pages' data", () => {
  it("sixteen pages (the top 15 business types of reports/business-type-catalogue.md and wholesale) with one honest headline, exactly three plain sections and a sample call of four lines", () => {
    expect(INDUSTRY_PAGES.map((p) => p.slug)).toEqual(["textiles", "clinics", "coaching", "real-estate", "car-dealers", "wholesale", "kirana", "jewellery", "electronics", "boutiques", "restaurants", "bakeries", "salons", "home-repair", "gyms", "small-business"]);
    // the top 15 of the catalogue (wholesale is the extra page)
    expect(INDUSTRY_PAGES.filter((p) => p.slug !== "wholesale")).toHaveLength(15);
    for (const p of INDUSTRY_PAGES) {
      expect(p.headline.length).toBeGreaterThan(10);
      expect(p.sections).toHaveLength(3);
      const call = (dict[`vc.cv.${p.pack}.friendly`] ?? "").split("\n").filter(Boolean);
      // a type the app already has a sample call for: the copy in the data is the app's own; a newer type (the catalogue's) has its own made-up call here
      if (call.length > 0) expect([...p.call], p.slug).toEqual(call);
      expect(p.call, p.slug).toHaveLength(4);
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
