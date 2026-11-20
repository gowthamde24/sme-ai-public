import { describe, expect, it } from "vitest";

import { PLAN_FACTS, PUBLIC_PLANS, rupees } from "@/lib/site/plans";

import { MOCK_PRICING } from "./pricing";

/**
 * The app's test catalogue must say what the public site (lib/site/plans.ts, the owner's final numbers of 19 Nov: docs/ project-docs/decision-plans-and-pricing.md) says: monthly price, included minutes, ₹5 for an extra minute on every plan,
 * one number included on every plan, every plan has every feature. (The real Billing screen shows the API's own `GET /v1/pricing` text: this pins the web's fixture so the two never drift again; 20 Nov: it still said ₹4.50 / ₹4 and 3 numbers.)
 */
const APP_ID = { payg: "payg", pro: "sales_assistant", business: "sales_lead_finder" } as const;

describe("the app's plan numbers equal the public site's", () => {
  for (const site of PUBLIC_PLANS) {
    it(`${site.name}: monthly price, included minutes, ₹${PLAN_FACTS.extraMinute} extra minute, 1 number`, () => {
      const app = MOCK_PRICING.plans.find((p) => p.id === APP_ID[site.id]);
      expect(app, site.id).toBeDefined();
      expect(app!.monthlyText).toBe(`${rupees(site.monthly)} a month`);
      expect(app!.includedMinutes).toBe(site.minutes ?? 0);
      expect(app!.rateText).toBe(`${rupees(PLAN_FACTS.extraMinute)} a minute`);
      expect(app!.numbersIncluded).toBe(1);
      expect(app!.leadFinder).toBe(true);
    });
  }
  it("no plan says 4.50 or 4 a minute any more", () => {
    expect(JSON.stringify(MOCK_PRICING)).not.toMatch(/4\.50|₹4 a minute/);
  });
});
