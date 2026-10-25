/**
 * The two meters (job DK): call minutes and business-initiated WhatsApp messages, as a count and a percentage. One gentle notice at 80 %; at 100 % calls and broadcast messages pause for the rest of the period; quotes, orders,
 * follow-ups and customers never stop. Pure, so the thresholds are tested without a browser. Nothing here knows a rupee or a token.
 */
export const NOTICE_AT = 80;
export const PAUSE_AT = 100;
export type MeterState = "ok" | "notice" | "paused" | "not_included" | "no_cap";
export type Reading = { used: number; included: number | null };

export function percent(r: Reading): number | null {
  if (r.included === null || r.included <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((Math.max(0, r.used) / r.included) * 100)));
}

export function meterState(r: Reading): MeterState {
  if (r.included === null) return "no_cap";
  if (r.included <= 0) return "not_included";
  const p = percent(r) ?? 0;
  if (p >= PAUSE_AT) return "paused";
  if (p >= NOTICE_AT) return "notice";
  return "ok";
}

/** What is left, never below zero; null when there is no cap or nothing is included. */
export function remaining(r: Reading): number | null {
  return r.included === null || r.included <= 0 ? null : Math.max(0, r.included - Math.max(0, r.used));
}

const DAY = 86_400_000;
/** Whole days left of the trial, counted up (a trial with 2 hours left has 1 day left), never below 0. */
export function trialDaysLeft(endsAt: string | null, now: Date): number {
  if (endsAt === null) return 0;
  const end = Date.parse(endsAt);
  return Number.isNaN(end) ? 0 : Math.max(0, Math.ceil((end - now.getTime()) / DAY));
}
/** The day of the trial it is today (1 to `days`): "cancel before day 30". */
export function trialDay(endsAt: string | null, now: Date, days: number): number {
  return Math.min(days, Math.max(1, days - trialDaysLeft(endsAt, now) + 1));
}
