import { formatRupeesShort } from "@/lib/money";

/**
 * The rupee balance and plan of a business for the Billing page (owner, 13 Nov 2026; C1's `GET /v1/tenants/{t}/billing/balance`, any member): `{balance_paise, balance_text, minutes_estimate, summary_text, plan_id, plan_name, low, topup_available,
 * free_start_granted, free_start_left_paise, free_start_left_text, included_minutes, included_minutes_left, subscription: {interval, status, period_end, cancel_at_period_end, price_locked_until}|null}`. Money is ₹ and never "credits".
 * The text of the balance is made HERE from the paise (the API's text is not trusted for the screen); a failed or odd answer is null. Pure.
 */
export type Subscription = { interval: "monthly" | "yearly"; status: string; periodEnd: string | null; cancelAtPeriodEnd: boolean };
export type BillingBalance = {
  paise: number;
  text: string;
  minutesEstimate: number | null;
  planId: string | null;
  planName: string | null;
  low: boolean;
  topupAvailable: boolean;
  freeStartGranted: boolean;
  /** The part of the free ₹50 not yet used, in words ("₹40"), or null. */
  freeStartLeftText: string | null;
  includedMinutes: number | null;
  includedMinutesLeft: number | null;
  subscription: Subscription | null;
};

const MAX = 100_000_000_00;
const whole = (v: unknown, max = 10_000_000): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null);
const word = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v : null);

export function parseBillingBalance(json: unknown): BillingBalance | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const paise = whole(o.balance_paise, MAX);
  if (paise === null) return null;
  let subscription: Subscription | null = null;
  const s = o.subscription;
  if (typeof s === "object" && s !== null && !Array.isArray(s)) {
    const x = s as Record<string, unknown>;
    if (x.interval === "monthly" || x.interval === "yearly") subscription = { interval: x.interval, status: word(x.status, 40) ?? "active", periodEnd: word(x.period_end, 40), cancelAtPeriodEnd: x.cancel_at_period_end === true };
  }
  const left = whole(o.free_start_left_paise, MAX);
  return {
    paise,
    text: formatRupeesShort(paise),
    minutesEstimate: whole(o.minutes_estimate),
    planId: word(o.plan_id, 60),
    planName: word(o.plan_name, 60),
    low: o.low === true,
    topupAvailable: o.topup_available === true,
    freeStartGranted: o.free_start_granted === true,
    freeStartLeftText: left !== null && left > 0 ? formatRupeesShort(left) : null,
    includedMinutes: whole(o.included_minutes),
    includedMinutesLeft: whole(o.included_minutes_left),
    subscription,
  };
}
