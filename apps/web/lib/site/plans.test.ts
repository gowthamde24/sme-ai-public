import { describe, expect, it } from "vitest";

import { siteDict } from "@/i18n/site";
import { LANDING_LANGS } from "@/lib/seo/site";

import { PLAN_FACTS, PUBLIC_PLANS, planCrossovers, planVars, rupees } from "./plans";

describe("the three paid plans of the public site (owner's final numbers, 19 Nov 2026)", () => {
  it("are Pay as you go, Pro and Business at 499, 1,999 and 5,999 a month, before 18% GST", () => {
    expect(PUBLIC_PLANS.map((p) => [p.name, p.monthly, p.minutes, p.find.included, p.find.then, p.setup])).toEqual([
      ["Pay as you go", 499, null, 2, 49, "self"],
      ["Pro", 1999, 500, 10, 39, "self"],
      ["Business", 5999, 1500, 100, 29, "priority"],
    ]);
    expect(PUBLIC_PLANS.filter((p) => p.recommended).map((p) => p.name)).toEqual(["Pro"]);
    expect(PLAN_FACTS).toMatchObject({ gstPercent: 18, extraMinute: 5, extraNumber: 499, freeStart: 50, trialEmail: 30, trialPhone: 100, billingSeconds: 30, numberHoldDays: 30 });
  });
  it("cross over at about 300 and 1,300 minutes a month on calls alone", () => {
    expect(planCrossovers()).toEqual({ paygPro: 300, proBusiness: 1300 });
    expect(499 + 300 * 5).toBe(1999);
    expect(1999 + 800 * 5).toBe(5999);
  });
  it("formats rupees with the Indian grouping", () => {
    expect(rupees(1999)).toBe("₹1,999");
    expect(planVars()).toMatchObject({ minute: "5", number: "499", start: "50", pro: "1,999", payg_pro: "300", pro_biz: "1,300" });
  });
  it("the amounts written inside the pricing description are the plans' own, in every language", () => {
    for (const lang of LANDING_LANGS) {
      const text = siteDict(lang)["meta.pricing.description"];
      for (const p of PUBLIC_PLANS) expect(text, `${lang} ${p.name}`).toContain(rupees(p.monthly));
      expect(text).toContain("18% GST");
    }
  });
  it("no plan sentence says unlimited, and paid-plan facts carry the 'paid plans' or 'early access' words", () => {
    for (const lang of LANDING_LANGS) {
      const d = siteDict(lang);
      for (const [k, v] of Object.entries(d)) if (/^(pp|price\.faq)\./.test(k)) expect(v, `${lang} ${k}`).not.toMatch(/unlimited/i);
    }
    const en = siteDict("en");
    for (const n of [1, 2, 3, 4, 5, 6] as const) expect(en[`price.faq.${n}.a`], `faq ${n}`).toMatch(/paid plans|early access/i);
  });
});
