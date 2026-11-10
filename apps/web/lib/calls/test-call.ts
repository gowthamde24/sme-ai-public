/**
 * The owner's "Place a test call" screen, as pure parts (C1's PR #434: `POST /v1/tenants/{t}/calls/place`, Owner only). The form says what the API will refuse BEFORE it asks, in the person's own words; the API checks the same
 * things again (a goal that is 10 to 400 characters after trimming, with no phone number (six digits in a row, spaces and hyphens ignored), no "@", no link and no control character such as a line break). The gate's refusal
 * comes back as `409 call_not_allowed` with a closed `reason`; nothing was dialled when it does.
 */
export const GOAL_MIN = 10;
export const GOAL_MAX = 400;
/** The languages the screen offers (owner, 9 Nov 2026: English, Telugu and Kannada; Hindi stays as it is). The API also knows ta, ml and mr; they are not offered. */
export const TEST_LANGUAGES = ["en", "te", "kn", "hi"] as const;
export type TestLanguage = (typeof TEST_LANGUAGES)[number];
export const isTestLanguage = (v: unknown): v is TestLanguage => (TEST_LANGUAGES as readonly unknown[]).includes(v);

export type GoalProblem = "line" | "number" | "email" | "link" | "short" | "long";
/** Characters as the API counts them (code points, not UTF-16 units). */
const size = (s: string): number => [...s].length;

/** The first thing wrong with a goal, or null. The same rules as the API's `PlaceIn`; the line break is checked on the trimmed text (a trailing new line is dropped, one inside is refused). */
export function goalProblem(raw: string): GoalProblem | null {
  const goal = raw.trim();
  if ([...goal].some((c) => (c.codePointAt(0) ?? 0) < 32)) return "line";
  if (/\p{Nd}{6,}/u.test(goal.replaceAll(" ", "").replaceAll("-", ""))) return "number";
  if (goal.includes("@")) return "email";
  if (/https?:\/\/|www\./i.test(goal)) return "link";
  if (size(goal) > GOAL_MAX) return "long";
  if (size(goal) < GOAL_MIN) return "short";
  return null;
}
export const goalLength = (raw: string): number => size(raw.trim());

/** A phone number as a person types it: an optional +, then digits with spaces or hyphens between; ten to thirteen digits. The API's gate says whether it is on the test list. */
export function numberProblem(raw: string): "bad" | null {
  const s = raw.trim();
  if (!/^\+?[\d\s-]{8,20}$/.test(s)) return "bad";
  const digits = s.replace(/\D/g, "").length;
  return digits >= 10 && digits <= 13 ? null : "bad";
}

/** The gate's closed words (app/telephony/gate.py REASONS) that an outbound test call can meet; each has its own sentence (`tc.no.<word>`). Any other word is said by `tc.no.other`. */
export const REFUSED_REASONS = [
  "telephony_off", "live_not_confirmed", "bad_number", "not_on_sandbox_list", "not_approved", "workspace_paused", "billing_blocked", "purpose_not_allowed", "school_rule",
  "outside_window", "outside_hours", "holiday", "weekly_limit", "daily_cap", "minutes_cap", "no_consent", "suppressed", "erased_or_archived", "dnd", "dnd_unknown", "no_ai_disclosure", "already_calling", "too_many_calls",
] as const;
/** Money, consent and privacy sentences wait for a person's review: English in every language until then (`humanOnly` in the store). */
export const REVIEW_REASONS = ["billing_blocked", "minutes_cap", "no_consent", "suppressed", "erased_or_archived", "dnd", "dnd_unknown"] as const;
export function refusedKey(reason: string | null | undefined): string {
  return reason && (REFUSED_REASONS as readonly string[]).includes(reason) ? `tc.no.${reason}` : "tc.no.other";
}
