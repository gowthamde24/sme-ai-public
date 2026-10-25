import draft from "./plans.draft.json";
import type { PlanCatalogue, PlanDef } from "./types";

/** The plans as the screens read them. Today the draft file; when C1's API lands this is the one place that changes. */
export const CATALOGUE: PlanCatalogue = { trial: draft.trial, plans: draft.plans as unknown as readonly PlanDef[] };
export const planById = (id: string | null): PlanDef | null => (id === null ? null : (CATALOGUE.plans.find((p) => p.id === id) ?? null));
export const mainPlans = (): PlanDef[] => CATALOGUE.plans.filter((p) => p.kind === "main");
export const callsPlans = (): PlanDef[] => CATALOGUE.plans.filter((p) => p.kind === "calls");
