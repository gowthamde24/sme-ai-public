/**
 * The feature flag of the plan screens (job DK). Off by default, until billing is real: unset, "0" or anything else = off (Settings has no Plan part and /plans is a 404); "1" = on, reading the plans and billing API
 * of job DI (GET /v1/plans, GET /v1/tenants/{id}/billing, POST …/billing/trial and …/billing/cancel; see docs/contracts/plans-billing.md); "mock" = on with an in-memory FAKE provider whose state lives in a cookie (for review and
 * screenshots; no network, no money, nothing stored on a server). Read when the server handles a request (not baked into the bundle), like lib/auth/signup-open.ts.
 */
export type PlanScreens = "off" | "on" | "mock";
export function planScreens(value: string | undefined = process.env.PLAN_SCREENS): PlanScreens {
  return value === "mock" ? "mock" : value === "1" ? "on" : "off";
}

/** Only the FAKE payment provider exists today (the API accepts pm_fake_ok, pm_fake_declines_on_renewal, pm_fake_declined): the screens say "test mode" and offer those three test choices. Becomes false when a real checkout (Razorpay) is wired. */
export const FAKE_CHECKOUT = true;

/**
 * The real payment checkout (owner's C9, 13 Nov 2026; C1's `POST /billing/checkout`): `1` = before a plan starts the web asks the API for a checkout session; with the Razorpay TEST provider it opens Razorpay's own Checkout (the card or UPI detail goes to Razorpay, never to us) and starts the plan with
 * the three values it returns; with the fake provider (staging today, and while the API has no such route) it falls back to the three test payment choices. Anything else = the test choices only. The browser's content-security rules name Razorpay's addresses ONLY while this is `1` (lib/security/csp.ts).
 */
export const razorpayCheckout = (value: string | undefined = process.env.RAZORPAY_CHECKOUT): boolean => value === "1";
