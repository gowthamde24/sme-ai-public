/**
 * The plans and a workspace's place in them (job DK). Plans are DATA (C1's plans file and API, job DI: packages/plans/plans.json, GET /v1/plans): no plan id is written in a component. What an owner sees is counts and
 * percentages of TWO things only, call minutes and business-initiated WhatsApp messages: never rupees, never tokens (the AI itself is "included, fair use" with allowances the product keeps to itself).
 * The shapes of the API are in packages/contracts/billing.ts; these are the smaller shapes the screens read.
 */
export type PlanKind = "main" | "calls";
export type PlanDef = {
  id: string;
  kind: PlanKind;
  /** Plan names are names (Starter, Growth, Calls 300): the same in every language, like the product's own name. */
  name: string;
  /** null until the owner sets it: the screens say "Price coming soon". */
  priceInr: number | null;
  /** null = no cap (pay for what you use); 0 = not included in the plan. */
  callMinutes: number | null;
  messages: number | null;
  users: number | null;
  workspaces: number | null;
};
/** The trial: its length, what it includes, and the days a failed payment is given to be put right. */
export type TrialDef = { days: number; callMinutes: number; messages: number; graceDays: number };
export type PlanCatalogue = { trial: TrialDef; plans: readonly PlanDef[] };

/** none: no plan yet; trialing: inside the 30 days; active: paying; past_due: the last payment failed; cancelled: ended (inside the trial it ended with nothing charged). */
export type BillingState = "none" | "trialing" | "active" | "past_due" | "cancelled";
export type PaymentMethod = "none" | "test_ok" | "test_fails" | "test_declined";

export type WorkspacePlan = {
  /** The plan the business CHOSE (during the trial the allowances are the trial's, whatever it chose). */
  planId: string | null;
  state: BillingState;
  /** ISO 8601, set while trialing (or when it was cancelled in the trial). */
  trialEndsAt: string | null;
  /** "cancelled inside the trial": nothing was charged. */
  cancelledInTrial: boolean;
  /** A paid plan that was cancelled keeps going to the end of the period it paid for. */
  cancelAtPeriodEnd: boolean;
  /** Until when a failed payment can still be put right. */
  graceUntil: string | null;
  /** The end of the billing period the meters count in (India time), ISO 8601. */
  periodEndsAt: string | null;
  /** A trial is started once per workspace: false once any plan has been started. */
  canStartTrial: boolean;
  usage: { minutes: number; messages: number };
  included: { minutes: number | null; messages: number | null };
  paymentMethod: PaymentMethod;
};

export type PlanResult = { ok: true } | { ok: false; error: "not_available" | "forbidden" | "invalid" | "no_payment_method" | "already" | "declined" };

/** What the person is working with: the signed-in person's token and the workspace (the API says what they may do there). */
export type PlanCtx = { token: string; tenantId: string };
