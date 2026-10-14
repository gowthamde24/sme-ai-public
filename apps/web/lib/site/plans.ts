/**
 * The plans and their prices (job CM; the owner's pricing decision, blueprint section 7). Billing is OFF: these are the prices the product plans to charge, and the pricing page says so. Rupees, GST included.
 * No plan limit is stated anywhere because none has been decided; the page says the limits are being set.
 */
export const TRIAL_DAYS = 30;
export const PLANS = [
  { id: "starter", rupees: 499 },
  { id: "growth", rupees: 1499 },
  { id: "business", rupees: 3999 },
] as const;
export type PlanId = (typeof PLANS)[number]["id"];
/** The one-time done-for-you setup. */
export const DONE_FOR_YOU_RUPEES = 2999;

/** ₹1,499 and ₹3,999: Indian grouping (lakh, crore). */
export function formatRupees(rupees: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(rupees)}`;
}

export const LOWEST_PLAN_RUPEES = Math.min(...PLANS.map((p) => p.rupees));
