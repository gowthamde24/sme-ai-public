/**
 * The plans of the public site (job CM; job CX took the prices out). The owner decides the prices after usage tests, so NO amount is held anywhere on a public page or in this code: a plan is its name and
 * the pricing page says "Pricing announced soon". When the prices are decided they come back as a field of a plan here, with their own test, and never inside a sentence.
 */
export const TRIAL_DAYS = 14;
export const PLANS = [{ id: "starter" }, { id: "growth" }, { id: "business" }] as const;
export type PlanId = (typeof PLANS)[number]["id"];

/**
 * The three paid plans of the public site (owner's final numbers, 19 Nov 2026: ~/Desktop/stack19-jobs/project-docs/decision-plans-and-pricing.md). Prices are launch prices, per month, before 18% GST; the paid plans start in
 * February 2027 (Razorpay is in test mode until live billing, after Video KYC), so every page that shows them says "With paid plans (from February 2027)" and keeps early access free. The names are the owner-facing names and are
 * the same in every language. No "unlimited" anywhere. The numbers live ONLY here (a test pins them); sentences take them as {variables}.
 */
export type PublicPlanId = "payg" | "pro" | "business";
export type PublicPlan = {
  readonly id: PublicPlanId;
  readonly name: string;
  readonly monthly: number;
  /** Call minutes included each month; null = none included (Pay as you go pays for each minute). */
  readonly minutes: number | null;
  /** Find customers (Lead Finder) searches: `included` free each month, then `then` rupees for each further one. */
  readonly find: { readonly included: number; readonly then: number };
  readonly setup: "self" | "priority";
  readonly recommended: boolean;
};
export const PUBLIC_PLANS: readonly PublicPlan[] = [
  { id: "payg", name: "Pay as you go", monthly: 499, minutes: null, find: { included: 2, then: 49 }, setup: "self", recommended: false },
  { id: "pro", name: "Pro", monthly: 1999, minutes: 500, find: { included: 10, then: 39 }, setup: "self", recommended: true },
  { id: "business", name: "Business", monthly: 5999, minutes: 1500, find: { included: 100, then: 29 }, setup: "priority", recommended: false },
];
/** The facts every paid plan shares (rupees, minutes, percent). */
export const PLAN_FACTS = { gstPercent: 18, extraMinute: 5, extraNumber: 299, extraLine: 149, freeStart: 50, billingSeconds: 30, numberHoldDays: 30 } as const;

/** The monthly call minutes at which a dearer plan costs the same as the cheaper one on calls alone (extra minutes at the extra-minute price): Pay as you go -> Pro and Pro -> Business. Above it the dearer plan is cheaper. */
export function planCrossovers(): { paygPro: number; proBusiness: number } {
  const [payg, pro, biz] = PUBLIC_PLANS;
  return {
    paygPro: Math.round((pro.monthly - payg.monthly) / PLAN_FACTS.extraMinute),
    proBusiness: Math.round((biz.monthly - pro.monthly) / PLAN_FACTS.extraMinute + (pro.minutes ?? 0)),
  };
}

const inr = (n: number): string => new Intl.NumberFormat("en-IN").format(n);
export const rupees = (n: number): string => `₹${inr(n)}`;
/** The variables the plan sentences (pp.*, price.faq.*) take, as text. */
export function planVars(): Record<string, string> {
  const x = planCrossovers();
  const [payg, pro, biz] = PUBLIC_PLANS;
  return { minute: inr(PLAN_FACTS.extraMinute), number: inr(PLAN_FACTS.extraNumber), line: inr(PLAN_FACTS.extraLine), start: inr(PLAN_FACTS.freeStart), pro: inr(pro.monthly), payg: inr(payg.monthly), biz: inr(biz.monthly), payg_pro: inr(x.paygPro), pro_biz: inr(x.proBusiness) };
}
