import type { PlanResult } from "@/lib/plan/types";

/** The moves of the plan screens, bound to the workspace by the page (server actions). `fix` and `endTrial` are null where the provider has no such move (only the fake cookie provider has them). */
export type PlanActions = {
  start: (planId: string, method: string) => Promise<PlanResult>;
  cancel: () => Promise<PlanResult>;
  fix: (() => Promise<PlanResult>) | null;
  /** Test mode only: jump to day 30. */
  endTrial: (() => Promise<PlanResult>) | null;
};
