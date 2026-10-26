import { CATALOGUE, planById } from "./catalogue";
import type { BillingState, PaymentMethod, PlanResult, WorkspacePlan } from "./types";

/**
 * The FAKE billing provider of the screens (job DK), only for PLAN_SCREENS=mock: it behaves like C1's fake provider on the API (job DI, docs/contracts/plans-billing.md): the 30-day trial starts WITH a payment method, nothing is
 * charged during it, cancelling inside it is free, a trial is started once per workspace, cancelling a paid plan ends it at the end of the period, a payment that fails leaves it past due. Its whole state is ONE cookie of
 * eight fields, read with allow-lists and integer bounds (nothing in it is trusted): no server holds anything, no network is called, no card number exists anywhere (the "payment method" is a test choice).
 * With PLAN_SCREENS=1 the same screens read the API instead (lib/plan/source.ts).
 */
export const MOCK_COOKIE = "sme_plan_mock";
/** `cancelled` is "cancelled inside the trial" while the state is cancelled, and "ends at the end of the period" while the plan is active or past due. */
export type MockState = { state: BillingState; plan: string | null; method: PaymentMethod; day: number; minutes: number; messages: number; cancelled: boolean; readOnly: boolean };
const STATES: readonly BillingState[] = ["none", "trialing", "active", "past_due", "cancelled"];
const METHODS: readonly PaymentMethod[] = ["none", "test_ok", "test_fails", "test_declined"];
export const FRESH: MockState = { state: "none", plan: null, method: "none", day: 1, minutes: 0, messages: 0, cancelled: false, readOnly: false };
const int = (v: string | undefined, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return v !== undefined && /^\d{1,6}$/.test(v) && n >= lo && n <= hi ? n : fallback;
};

export function parseMock(raw: string | undefined): MockState {
  if (!raw) return FRESH;
  const [state, plan, method, day, minutes, messages, cancelled, readOnly] = raw.split(";");
  const s = STATES.find((x) => x === state);
  const m = METHODS.find((x) => x === method);
  const p = plan && planById(plan) ? plan : null;
  if (!s || !m || (s !== "none" && !p)) return FRESH; // a plan that is not on the list is no plan: the cookie is read as a fresh workspace
  return { state: s, plan: p, method: m, day: int(day, 1, CATALOGUE.trial.days, 1), minutes: int(minutes, 0, 100_000, 0), messages: int(messages, 0, 100_000, 0), cancelled: s !== "none" && s !== "trialing" && cancelled === "1", readOnly: s !== "none" && s !== "trialing" && readOnly === "1" };
}
export const encodeMock = (m: MockState): string => [m.state, m.plan ?? "", m.method, m.day, m.minutes, m.messages, m.cancelled ? "1" : "0", m.readOnly ? "1" : "0"].join(";");

const DAY = 86_400_000;
/** A read-only workspace's data is kept this long, then deleted (docs/contracts/plans-billing.md). */
const READ_ONLY_DAYS = 90;
const isoDay = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
export function toWorkspacePlan(m: MockState, now: Date): WorkspacePlan {
  const plan = planById(m.plan);
  const cancelledInTrial = m.state === "cancelled" && m.cancelled;
  const trial = m.state === "none" || m.state === "trialing" || cancelledInTrial; // a workspace with no plan gets the trial's allowances, like the API's
  const included = trial || !plan ? { minutes: CATALOGUE.trial.callMinutes, messages: CATALOGUE.trial.messages } : { minutes: plan.callMinutes, messages: plan.messages };
  const left = CATALOGUE.trial.days - m.day + 1;
  return {
    planId: m.plan,
    state: m.state,
    trialEndsAt: m.state === "trialing" || cancelledInTrial ? new Date(now.getTime() + left * DAY).toISOString() : null,
    cancelledInTrial,
    cancelAtPeriodEnd: (m.state === "active" || m.state === "past_due") && m.cancelled,
    graceUntil: m.state === "past_due" ? new Date(now.getTime() + CATALOGUE.trial.graceDays * DAY).toISOString() : null,
    periodEndsAt: new Date(now.getTime() + (m.state === "trialing" ? left : 30) * DAY).toISOString(),
    canResume: false, // the fake provider never lapses a plan into "pay again"
    canStartTrial: m.state === "none",
    usage: { minutes: m.minutes, messages: m.messages },
    included,
    paymentMethod: m.method,
    access: m.readOnly ? "read_only" : "full",
    readOnlySince: m.readOnly ? isoDay(now) : null,
    deleteOn: m.readOnly ? isoDay(new Date(now.getTime() + READ_ONLY_DAYS * DAY)) : null,
    dataDaysLeft: m.readOnly ? READ_ONLY_DAYS : null,
  };
}

/** The fake provider's moves. Each returns the new state or a refusal, never throws. */
export function startTrial(m: MockState, planId: string, method: string): { next: MockState } | { error: Extract<PlanResult, { ok: false }>["error"] } {
  if (!planById(planId)) return { error: "invalid" };
  if (method !== "test_ok" && method !== "test_fails" && method !== "test_declined") return { error: "no_payment_method" }; // the trial starts WITH a payment method
  if (m.state !== "none") return { error: "already" }; // once per workspace, also after a cancelled one
  if (method === "test_declined") return { error: "declined" };
  return { next: { state: "trialing", plan: planId, method, day: 1, minutes: 0, messages: 0, cancelled: false, readOnly: false } };
}
export function cancel(m: MockState): { next: MockState } | { error: "invalid" } {
  if (m.state === "trialing") return { next: { ...m, state: "cancelled", cancelled: true } }; // before day 30: nothing is charged
  if ((m.state === "active" || m.state === "past_due") && !m.cancelled) return { next: { ...m, cancelled: true } }; // a paid plan runs to the end of its period
  return { error: "invalid" };
}
export function fixPayment(m: MockState): { next: MockState } | { error: "invalid" } {
  return m.state === "past_due" ? { next: { ...m, state: "active", method: "test_ok" } } : { error: "invalid" };
}
/** Test only: the trial reaches its last day and the first payment is tried with the test payment method. A card that works makes the plan active; one that fails leaves it past due. */
export function endTrial(m: MockState): { next: MockState } | { error: "invalid" } {
  if (m.state !== "trialing") return { error: "invalid" };
  return { next: { ...m, state: m.method === "test_fails" ? "past_due" : "active", day: CATALOGUE.trial.days, minutes: 0, messages: 0, cancelled: false, readOnly: false } };
}
