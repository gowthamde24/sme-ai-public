import { PLAN_KEYS, type PlanKey } from "./names";
import { EXTRA_NUMBER_PAISE, MINUTE_PAISE, NUMBERS_INCLUDED, PLAN_TERMS } from "./plans-v2";

/**
 * "You'd save ₹600 on Pro this month" (owner's final pricing, 19 Nov 2026): the cost of this month under each plan, worked out from the usage lines alone, and the cheapest plan when it is cheaper than the one in use by a few rupees or more.
 * Pure: no request, no clock. Money is integer paise. WhatsApp costs what Meta charges on every plan, so it is not part of the comparison.
 *   Pay as you go = ₹499 + ₹5 a minute; Pro = ₹1,999 with 500 minutes; Business = ₹5,999 with 1,500; a minute beyond the included ones is ₹5; each Find-customers search beyond the free ones is ₹49 / ₹39 / ₹29; each number beyond the first is ₹299.
 *   Pay as you go costs the same as Pro at 300 minutes (₹499 + 300 x ₹5 = ₹1,999): above that Pro is cheaper.
 */
export type MonthUsage = {
  /** Call minutes used this month (halves count: calls are billed every 30 seconds). */
  minutes: number;
  /** Find-customers searches run this month. */
  searches: number;
  /** Numbers you have in all (the first is included). */
  numbers: number;
};

/** A hint smaller than this is not worth saying (₹100). */
export const MIN_SAVING_PAISE = 100_00;

export function monthCostPaise(plan: PlanKey, usage: MonthUsage): number {
  const t = PLAN_TERMS[plan];
  const minutes = Math.max(0, usage.minutes);
  const searches = Math.max(0, Math.floor(usage.searches));
  const extraNumbers = Math.max(0, Math.floor(usage.numbers) - NUMBERS_INCLUDED);
  const extraMinutes = Math.max(0, minutes - t.includedMinutes);
  const paidSearches = Math.max(0, searches - t.freeSearches);
  return t.monthlyPaise + Math.round(extraMinutes * MINUTE_PAISE) + paidSearches * t.searchPaise + extraNumbers * EXTRA_NUMBER_PAISE;
}

/** What the month so far would cost over the whole month, for a hint early in the month: the minutes and searches grow with the days, the numbers do not. `day` of `days` (1 to days); a month that is over or unknown counts as it is. */
export function projectUsage(usage: MonthUsage, day: number, days: number): MonthUsage {
  if (!Number.isFinite(day) || !Number.isFinite(days) || days <= 0 || day >= days) return usage;
  const share = Math.max(day, 1) / days;
  return { minutes: usage.minutes / share, searches: Math.round(usage.searches / share), numbers: usage.numbers };
}

export type UpgradeHint = { plan: PlanKey; savePaise: number };

/** The cheapest plan for this usage, when it saves at least `MIN_SAVING_PAISE` against the plan in use; else null. A tie goes to the plan in use, then to the smaller plan. */
export function upgradeHint(current: PlanKey, usage: MonthUsage): UpgradeHint | null {
  const now = monthCostPaise(current, usage);
  let best: UpgradeHint | null = null;
  for (const plan of PLAN_KEYS) {
    if (plan === current) continue;
    const save = now - monthCostPaise(plan, usage);
    if (save >= MIN_SAVING_PAISE && (best === null || save > best.savePaise)) best = { plan, savePaise: save };
  }
  return best;
}

/** The minutes at which Pay as you go costs as much as Pro (300). */
export const PAYG_PRO_BREAK_EVEN_MINUTES = (PLAN_TERMS.pro.monthlyPaise - PLAN_TERMS.payg.monthlyPaise) / MINUTE_PAISE;
