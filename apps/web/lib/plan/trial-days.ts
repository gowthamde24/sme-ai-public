/**
 * The length of the free trial, in days, as the public texts say it (job DO). Every string that names it says `{trial_days}` and never the number: `fill()`, the dictionaries and `fillLegal()` put this in, so one change moves every
 * page, the sign-in screens and the legal texts. The number is the plans data's (packages/plans/plans.json, the catalogue C1's API serves, `plans.draft.json`): a test (trial-days.test.ts) fails if it is not, so changing the trial
 * in the data fails CI until this line follows. It is NOT imported from the data file on purpose: `fill()` is in the browser bundle of every page and the plans file would travel with it (about 7 KB gzip against the route budgets).
 * The Plan screens read the number from the catalogue they were given (`{days}`).
 */
export const TRIAL_DAYS = 14;
export const TRIAL_DAYS_PLACEHOLDER = "{trial_days}";
/** A text with `{trial_days}` replaced by the trial's length. */
export const withTrialDays = (text: string): string => (text.includes(TRIAL_DAYS_PLACEHOLDER) ? text.replaceAll(TRIAL_DAYS_PLACEHOLDER, String(TRIAL_DAYS)) : text);
