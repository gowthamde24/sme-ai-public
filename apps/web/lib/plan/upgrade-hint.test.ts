import { describe, expect, it } from "vitest";

import { PLAN_KEYS, PLAN_KEY_NAMES, planKeyOf, planName } from "./names";
import { PLAN_TERMS } from "./plans-v2";
import { MIN_SAVING_PAISE, PAYG_PRO_BREAK_EVEN_MINUTES, monthCostPaise, projectUsage, upgradeHint } from "./upgrade-hint";

const rs = (n: number) => n * 100;
const use = (minutes: number, searches = 0, numbers = 1) => ({ minutes, searches, numbers });

describe("what a month costs under each plan (the owner's final numbers, before GST)", () => {
  it("Pay as you go is ₹499 plus ₹5 a minute, 2 searches free then ₹49", () => {
    expect(monthCostPaise("payg", use(0))).toBe(rs(499));
    expect(monthCostPaise("payg", use(100))).toBe(rs(999));
    expect(monthCostPaise("payg", use(0, 2))).toBe(rs(499));
    expect(monthCostPaise("payg", use(0, 5))).toBe(rs(499 + 3 * 49));
  });
  it("Pro is ₹1,999 with 500 minutes, extra minutes ₹5, 10 searches free then ₹39", () => {
    expect(monthCostPaise("pro", use(500))).toBe(rs(1999));
    expect(monthCostPaise("pro", use(540))).toBe(rs(1999 + 200));
    expect(monthCostPaise("pro", use(0, 12))).toBe(rs(1999 + 2 * 39));
  });
  it("Business is ₹5,999 with 1,500 minutes, extra minutes ₹5, 100 searches free then ₹29", () => {
    expect(monthCostPaise("business", use(1500))).toBe(rs(5999));
    expect(monthCostPaise("business", use(1600, 110))).toBe(rs(5999 + 500 + 10 * 29));
  });
  it("each number after the first is ₹499 on every plan, and half minutes count", () => {
    for (const p of PLAN_KEYS) expect(monthCostPaise(p, use(0, 0, 3)) - monthCostPaise(p, use(0, 0, 1))).toBe(rs(998));
    expect(monthCostPaise("payg", use(10.5))).toBe(rs(499) + 5250);
  });
  it("the table is the owner's: prices, included minutes, free searches, popular and priority", () => {
    expect(PLAN_KEYS.map((k) => PLAN_TERMS[k].monthlyPaise / 100)).toEqual([499, 1999, 5999]);
    expect(PLAN_KEYS.map((k) => PLAN_TERMS[k].includedMinutes)).toEqual([0, 500, 1500]);
    expect(PLAN_KEYS.map((k) => [PLAN_TERMS[k].freeSearches, PLAN_TERMS[k].searchPaise / 100])).toEqual([[2, 49], [10, 39], [100, 29]]);
    expect(PLAN_KEYS.filter((k) => PLAN_TERMS[k].popular)).toEqual(["pro"]);
    expect(PLAN_KEYS.filter((k) => PLAN_TERMS[k].priorityOnboarding)).toEqual(["business"]);
  });
});

describe("the upgrade hint", () => {
  it("Pay as you go costs as much as Pro at 300 minutes, and more above that", () => {
    expect(PAYG_PRO_BREAK_EVEN_MINUTES).toBe(300);
    expect(monthCostPaise("payg", use(300))).toBe(monthCostPaise("pro", use(300)));
    expect(upgradeHint("payg", use(300))).toBeNull();
    expect(upgradeHint("payg", use(301))).toBeNull(); // saves ₹5: too small to say
    expect(upgradeHint("payg", use(320))).toEqual({ plan: "pro", savePaise: rs(100) });
  });
  it("420 minutes on Pay as you go: 'You'd save ₹600 on Pro'", () => {
    expect(upgradeHint("payg", use(420))).toEqual({ plan: "pro", savePaise: rs(600) });
  });
  it("a heavy month on Pay as you go points to Business, not Pro, when that saves more", () => {
    const hint = upgradeHint("payg", use(1500));
    expect(hint?.plan).toBe("business");
    expect(hint?.savePaise).toBe(rs(499 + 7500 - 5999));
  });
  it("Pro to Business when the extra minutes cost more than the step", () => {
    expect(upgradeHint("pro", use(1200))).toBeNull(); // 1999 + 700 x 5 = 5499 < 5999
    expect(upgradeHint("pro", use(1500))?.plan).toBe("business"); // 1999 + 1000 x 5 = 6999
  });
  it("a light month on Pro or Business points down to a cheaper plan", () => {
    expect(upgradeHint("pro", use(40))).toEqual({ plan: "payg", savePaise: rs(1999 - 699) });
    expect(upgradeHint("business", use(300))?.plan).toBe("payg");
  });
  it("says nothing when the plan in use is the cheapest, or the saving is under the least worth saying", () => {
    expect(upgradeHint("pro", use(500))).toBeNull();
    expect(upgradeHint("payg", use(0))).toBeNull();
    expect(MIN_SAVING_PAISE).toBe(rs(100));
  });
  it("extra numbers cost the same on every plan, so they never change the hint", () => {
    expect(upgradeHint("payg", use(420, 0, 4))).toEqual({ plan: "pro", savePaise: rs(600) });
  });
  it("early in the month the minutes are projected over the whole month", () => {
    const early = projectUsage(use(30, 1), 3, 30);
    expect(early).toEqual({ minutes: 300, searches: 10, numbers: 1 });
    expect(projectUsage(use(30, 1), 30, 30)).toEqual(use(30, 1));
    expect(projectUsage(use(30, 1), 0, 0)).toEqual(use(30, 1));
    expect(upgradeHint("pro", projectUsage(use(30), 3, 30))).toBeNull(); // 300 min is Pay as you go = Pro
  });
});

describe("the owner-facing names", () => {
  it("are Pay as you go, Pro and Business, and map the API's ids", () => {
    expect(PLAN_KEYS.map((k) => PLAN_KEY_NAMES[k])).toEqual(["Pay as you go", "Pro", "Business"]);
    expect(planName("payg")).toBe("Pay as you go");
    expect(planName("sales_assistant")).toBe("Pro");
    expect(planName("sales_lead_finder")).toBe("Business");
    expect(planKeyOf("calls_300")).toBe("pro");
  });
  it("keeps the API's own name for an id it does not know, and never says the old plan names", () => {
    expect(planName("starter", "Starter")).toBe("Starter");
    expect(planName(null, "X")).toBe("X");
    expect(planName("zzz")).toBeNull();
    for (const k of PLAN_KEYS) expect(PLAN_KEY_NAMES[k]).not.toMatch(/lead desk|workforce|lead finder|unlimited/i);
  });
});
