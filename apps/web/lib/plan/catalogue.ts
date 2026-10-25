import type { PlanOut, PlansOut } from "@contracts/billing";

import draft from "./plans.draft.json";
import type { PlanCatalogue, PlanDef } from "./types";

/**
 * The plans as the screens read them. The API's catalogue (GET /v1/plans) is turned into PlanCatalogue by `catalogueFrom`; the test-mode provider uses the DRAFT file (a copy of packages/plans/plans.json, a test
 * keeps the two equal). Prices are null until the owner sets them; every plan is data, none is named in a component.
 */
const toDef = (p: PlanOut): PlanDef => ({
  id: p.id,
  kind: p.kind === "calls" ? "calls" : "main",
  name: p.name.en,
  priceInr: p.price_paise_monthly === null ? null : p.price_paise_monthly / 100,
  callMinutes: p.allowances.call_minutes,
  messages: p.allowances.whatsapp_messages,
  users: p.limits.users,
  workspaces: p.limits.workspaces,
});

export function catalogueFrom(out: PlansOut): PlanCatalogue {
  const trial = out.plans.find((p) => p.kind === "trial");
  return {
    trial: { days: out.trial.days, callMinutes: trial?.allowances.call_minutes ?? 0, messages: trial?.allowances.whatsapp_messages ?? 0, graceDays: out.trial.grace_days_after_failed_payment },
    plans: [...out.plans].filter((p) => p.kind !== "trial").sort((a, b) => a.sort - b.sort).map(toDef),
  };
}

type DraftPlan = Omit<PlanOut, "price_set" | "name"> & { name: { en: string } };
/** The draft file in the shape of the API's answer, so the test-mode provider and the real API go through the same code. */
export const DRAFT_PLANS: PlansOut = {
  catalogue_version: draft.version,
  status: "draft",
  currency: "INR",
  trial: { days: draft.trial.days, payment_method_at_start: draft.trial.payment_method_at_start, grace_days_after_failed_payment: draft.trial.grace_days_after_failed_payment },
  plans: (draft.plans as unknown as DraftPlan[]).map((p) => ({ ...p, name: { en: p.name.en, te: null, hi: null, kn: null }, price_paise_per_minute: p.price_paise_per_minute ?? null, price_paise_per_message: p.price_paise_per_message ?? null, price_set: p.price_paise_monthly !== null })),
};

export const CATALOGUE: PlanCatalogue = catalogueFrom(DRAFT_PLANS);
export const planById = (id: string | null, cat: PlanCatalogue = CATALOGUE): PlanDef | null => (id === null ? null : (cat.plans.find((p) => p.id === id) ?? null));
export const mainPlans = (cat: PlanCatalogue = CATALOGUE): PlanDef[] => cat.plans.filter((p) => p.kind === "main");
export const callsPlans = (cat: PlanCatalogue = CATALOGUE): PlanDef[] => cat.plans.filter((p) => p.kind === "calls");
