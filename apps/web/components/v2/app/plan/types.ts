import type { CheckoutResult, PlanResult } from "@/lib/plan/types";

/** The moves of the plan screens, bound to the workspace by the page (server actions). `fix` and `endTrial` are null where the provider has no such move (only the fake cookie provider has them). */
export type PlanActions = {
  start: (planId: string, method: string) => Promise<PlanResult>;
  /** Razorpay's Checkout (RAZORPAY_CHECKOUT=1): a session for the plan, or "fake" (the test choices stay). null = the flag is off. */
  checkout?: ((planId: string) => Promise<CheckoutResult>) | null;
  cancel: () => Promise<PlanResult>;
  fix: (() => Promise<PlanResult>) | null;
  /** Test mode only: jump to day 30. */
  endTrial: (() => Promise<PlanResult>) | null;
};
