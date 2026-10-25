import { CATALOGUE, planById } from "./catalogue";
import type { BillingState, PaymentMethod, PlanResult, WorkspacePlan } from "./types";

/**
 * The FAKE billing provider (job DK), only for PLAN_SCREENS=mock: start the 30-day trial with a payment method, cancel before day 30 (nothing is charged), a payment that fails and the way out of it. Its whole
 * state is ONE cookie of seven fields, read with allow-lists and integer bounds (nothing in it is trusted): no server holds anything, no network is called, no card number exists anywhere (the "payment method" is a test choice).
 * Superseded by C1's fake provider on the API (job DI) when its contract is there; the screens do not change, only lib/plan/source.ts.
 */
export const MOCK_COOKIE = "sme_plan_mock";
export type MockState = { state: BillingState; plan: string | null; method: PaymentMethod; day: number; minutes: number; messages: number; cancelledInTrial: boolean };
const STATES: readonly BillingState[] = ["none", "trialing", "active", "past_due", "cancelled"];
const METHODS: readonly PaymentMethod[] = ["none", "test_ok", "test_fails"];
export const FRESH: MockState = { state: "none", plan: null, method: "none", day: 1, minutes: 0, messages: 0, cancelledInTrial: false };
const int = (v: string | undefined, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return v !== undefined && /^\d{1,6}$/.test(v) && n >= lo && n <= hi ? n : fallback;
};

export function parseMock(raw: string | undefined): MockState {
  if (!raw) return FRESH;
  const [state, plan, method, day, minutes, messages, cancelled] = raw.split(";");
  const s = STATES.find((x) => x === state);
  const m = METHODS.find((x) => x === method);
  const p = plan && planById(plan) ? plan : null;
  if (!s || !m || (s !== "none" && !p)) return FRESH; // a plan that is not on the list is no plan: the cookie is read as a fresh workspace
  return { state: s, plan: p, method: m, day: int(day, 1, CATALOGUE.trial.days, 1), minutes: int(minutes, 0, 100_000, 0), messages: int(messages, 0, 100_000, 0), cancelledInTrial: s === "cancelled" && cancelled === "1" };
}
export const encodeMock = (m: MockState): string => [m.state, m.plan ?? "", m.method, m.day, m.minutes, m.messages, m.cancelledInTrial ? "1" : "0"].join(";");

const DAY = 86_400_000;
export function toWorkspacePlan(m: MockState, now: Date): WorkspacePlan {
  const plan = planById(m.plan);
  const cancelledInTrial = m.state === "cancelled" && m.cancelledInTrial;
  const trial = m.state === "trialing" || cancelledInTrial;
  const included = trial ? { minutes: CATALOGUE.trial.callMinutes, messages: CATALOGUE.trial.messages } : plan ? { minutes: plan.callMinutes, messages: plan.messages } : { minutes: null, messages: null };
  const left = CATALOGUE.trial.days - m.day + 1;
  return {
    planId: m.plan,
    state: m.state,
    trialEndsAt: m.state === "trialing" || cancelledInTrial ? new Date(now.getTime() + left * DAY).toISOString() : null,
    cancelledInTrial,
    periodEndsAt: m.state === "none" ? null : new Date(now.getTime() + (m.state === "trialing" ? left : 30) * DAY).toISOString(),
    usage: { minutes: m.minutes, messages: m.messages },
    included,
    paymentMethod: m.method,
  };
}

/** The fake provider's moves. Each returns the new state or a refusal, never throws. */
export function startTrial(m: MockState, planId: string, method: string): { next: MockState } | { error: Extract<PlanResult, { ok: false }>["error"] } {
  if (!planById(planId)) return { error: "invalid" };
  if (method !== "test_ok" && method !== "test_fails") return { error: "no_payment_method" }; // the trial starts WITH a payment method
  if (m.state === "trialing" || m.state === "active" || m.state === "past_due") return { error: "already" };
  return { next: { state: "trialing", plan: planId, method, day: 1, minutes: 0, messages: 0, cancelledInTrial: false } };
}
export function cancel(m: MockState): { next: MockState } | { error: "invalid" } {
  if (m.state === "trialing") return { next: { ...m, state: "cancelled", cancelledInTrial: true } }; // before day 30: nothing is charged
  if (m.state === "active" || m.state === "past_due") return { next: { ...m, state: "cancelled", cancelledInTrial: false } };
  return { error: "invalid" };
}
export function fixPayment(m: MockState): { next: MockState } | { error: "invalid" } {
  return m.state === "past_due" ? { next: { ...m, state: "active", method: "test_ok" } } : { error: "invalid" };
}
/** Test only: the trial reaches its last day and the first payment is tried with the test payment method. A card that works makes the plan active; one that fails leaves it past due. */
export function endTrial(m: MockState): { next: MockState } | { error: "invalid" } {
  if (m.state !== "trialing") return { error: "invalid" };
  return { next: { ...m, state: m.method === "test_fails" ? "past_due" : "active", day: CATALOGUE.trial.days, minutes: 0, messages: 0, cancelledInTrial: false } };
}
