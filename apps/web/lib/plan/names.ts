/**
 * The owner-facing plan names, in ONE place (owner decision of 19 Nov 2026, docs: "Pay as you go / Pro / Business"; "Lead Desk" and "AI Workforce" are retired names). The API's plan ids stay as they are; a screen that
 * shows a plan name goes through `planName` (the catalogue, the balance on the Billing page and the plan badge do). A plan id that is not here is shown as the API names it (`fallback`). Names are the same in every language.
 *
 * Mapped: the plans catalogue (`GET /v1/plans`): `calls_payg` (was "Pay as you go"), `calls_300` (was "Lead Desk 300"), `calls_1000` (was "Lead Desk 1,000"); and the billing v2 plans (`GET .../billing/pricing`, the balance):
 * `payg` (Pay as you go), `sales_assistant` (was "Sales assistant", Rs 1,999: Pro), `sales_lead_finder` (was "Sales assistant with Lead Finder", Rs 5,999: Business).
 * NOT mapped (the API's own name is shown): `free_trial`, `starter`, `growth`, `business` (the old main plans, they have no owner-facing name in the decision) and any plan id C1 adds later.
 */
export const PLAN_NAMES: Readonly<Record<string, "Pay as you go" | "Pro" | "Business">> = {
  calls_payg: "Pay as you go",
  calls_300: "Pro",
  calls_1000: "Business",
  payg: "Pay as you go",
  sales_assistant: "Pro",
  sales_lead_finder: "Business",
};

/** The name to show for a plan id: the owner-facing one, else `fallback` (what the API calls it), else null. */
export function planName(id: string | null | undefined, fallback: string | null = null): string | null {
  if (typeof id !== "string" || !Object.hasOwn(PLAN_NAMES, id)) return fallback;
  return PLAN_NAMES[id] ?? fallback;
}

/** The three owner-facing plans as keys (billing v2: the upgrade hint, the plans table and the wallet screen work with these, never with an API id). */
export const PLAN_KEYS = ["payg", "pro", "business"] as const; // plan-id-ok: owner-facing keys, not API ids
export type PlanKey = (typeof PLAN_KEYS)[number];
export const PLAN_KEY_NAMES: Readonly<Record<PlanKey, string>> = { payg: "Pay as you go", pro: "Pro", business: "Business" }; // plan-id-ok

/** The owner-facing plan of an API plan id (through PLAN_NAMES, so there is ONE table), or null for an id that has none. */
export function planKeyOf(id: string | null | undefined): PlanKey | null {
  const name = planName(id);
  return PLAN_KEYS.find((k) => PLAN_KEY_NAMES[k] === name) ?? null;
}
