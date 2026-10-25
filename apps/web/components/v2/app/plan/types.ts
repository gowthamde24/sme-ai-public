import type { PlanResult } from "@/lib/plan/types";

/** The three moves of the fake provider, bound to the workspace by the page (server actions). The same shape will serve C1's API (job DI). */
export type PlanActions = {
  start: (planId: string, method: string) => Promise<PlanResult>;
  cancel: () => Promise<PlanResult>;
  fix: () => Promise<PlanResult>;
  /** Test mode only: jump to day 30. null when the provider is not the fake one. */
  endTrial: (() => Promise<PlanResult>) | null;
};
