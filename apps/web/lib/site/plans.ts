/**
 * The plans of the public site (job CM; job CX took the prices out). The owner decides the prices after usage tests, so NO amount is held anywhere on a public page or in this code: a plan is its name and
 * the pricing page says "Pricing announced soon". When the prices are decided they come back as a field of a plan here, with their own test, and never inside a sentence.
 */
export const TRIAL_DAYS = 14;
export const PLANS = [{ id: "starter" }, { id: "growth" }, { id: "business" }] as const;
export type PlanId = (typeof PLANS)[number]["id"];
