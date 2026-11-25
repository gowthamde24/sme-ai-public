import type { PlanKey } from "./names";

/**
 * The owner's FINAL plans and prices (docs "Plans and pricing", 19 Nov 2026), in paise, +18% GST on top. ONE table for the billing screen, the upgrade hint and the pricing page draft, so the numbers never drift apart. They are the web's own
 * until C1's `GET /v1/pricing` carries the same (its texts still say the 13 Nov numbers): then this table is read from there and this file keeps only the shape. Every plan has every feature; plans differ only in what is included.
 * Billing is per 30 seconds, unanswered calls are free, WhatsApp is at Meta's cost with no markup and nothing is charged for the assistant's actions (those are sentences in i18n `bill.*`, not numbers here).
 */
export type PlanTerms = {
  /** The monthly fee. */
  monthlyPaise: number;
  /** Call minutes inside the monthly fee (0 on Pay as you go: every minute is paid from the wallet). */
  includedMinutes: number;
  /** Find-customers searches free each month, then `searchPaise` each. */
  freeSearches: number;
  searchPaise: number;
  priorityOnboarding: boolean;
  popular: boolean;
};

export const PLAN_TERMS: Readonly<Record<PlanKey, PlanTerms>> = {
  payg: { monthlyPaise: 499_00, includedMinutes: 0, freeSearches: 2, searchPaise: 49_00, priorityOnboarding: false, popular: false },
  pro: { monthlyPaise: 1_999_00, includedMinutes: 500, freeSearches: 10, searchPaise: 39_00, priorityOnboarding: false, popular: true },
  business: { monthlyPaise: 5_999_00, includedMinutes: 1500, freeSearches: 100, searchPaise: 29_00, priorityOnboarding: true, popular: false },
};

/** A minute beyond the plan's own (or any minute on Pay as you go): the same on every plan. */
export const MINUTE_PAISE = 5_00;
/** 1 number is included; each extra number a month, on every plan. */
export const NUMBERS_INCLUDED = 1;
export const EXTRA_NUMBER_PAISE = 499_00;
export const GST_PERCENT = 18;
/** The free start for a new business. */
export const FREE_START_PAISE = 50_00;
/** Money added to the wallet stays usable for this many days. */
export const TOPUP_CARRY_DAYS = 90;
/** Billing steps of a call, in seconds; a call nobody answers is free. */
export const BILLING_STEP_SECONDS = 30;
/** After an unpaid end the account is read-only and the data is kept this many days. */
export const DATA_KEPT_DAYS = 90;
/** Paying a year at once is this many months free. */
