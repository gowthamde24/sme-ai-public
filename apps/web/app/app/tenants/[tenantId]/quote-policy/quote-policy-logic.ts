/**
 * Pure logic of the quote policy page (no server, no React): what a person's typed text means, in exact integers, and the sentences for every refusal. Every rule here is GUIDANCE for the screen:
 * the API and the database check every limit again when anything is saved.
 *
 * Conversions are done by reading the text, never with floating point: a percent becomes basis points (12.5 -> 1250) and rupees become paise (12.5 -> 1250) by moving two digits. More than two
 * digits after the point, a sign, an exponent, a comma, a letter, a non-ASCII digit or an empty field is refused with a sentence BEFORE any request is made.
 */
import { isCanonicalUuid } from "@/lib/api/crm";
import { POLICY_LIMITS, type QuotePolicyInput } from "@/lib/api/quote-policies";

/** The names of the form's fields (the same in the form and in the server action). */
export const FIELD_NAMES = ["effective_from", "validity_days", "new_advance", "repeat_advance", "new_net_days", "repeat_net_days", "gst_rate", "credit_limit", "seller_state", "discount_ceiling"] as const;
export type FieldName = (typeof FIELD_NAMES)[number];
export type PolicyValues = Record<FieldName, string>;

/** Every field starts empty: there is no default of ours. */
export const EMPTY_VALUES: PolicyValues = {
  effective_from: "",
  validity_days: "",
  new_advance: "",
  repeat_advance: "",
  new_net_days: "",
  repeat_net_days: "",
  gst_rate: "",
  credit_limit: "",
  seller_state: "",
  discount_ceiling: "",
};

const WHOLE = /^[0-9]{1,3}$/;
// At most 12 digits before the point (a bigger number is out of every range anyway, and 12 digits times 100 stays an exact integer) and at most two after it. ASCII digits only.
const DECIMAL = /^([0-9]{1,12})(?:\.([0-9]{1,2}))?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATE = /^[A-Z]{2}$/;

/** A whole number from `min` to `max` (digits only), or null. */
export function wholeNumber(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!WHOLE.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** The text as an exact integer of hundredths (12.5 -> 1250, "0.01" -> 1), or null when it is not digits with at most two digits after the point. */
export function hundredths(text: string): number | null {
  const m = DECIMAL.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** A percent from 0 to 100 as basis points (exact), or null. */
export function percentToBps(text: string): number | null {
  const v = hundredths(text);
  return v !== null && v <= POLICY_LIMITS.advanceBps.max ? v : null;
}

/** The GST rate: a percent from 0 to 28 as basis points (exact), or null. */
export function gstPercentToBps(text: string): number | null {
  const v = hundredths(text);
  return v !== null && v <= POLICY_LIMITS.gstRateBps.max ? v : null;
}

/** Rupees as paise (exact), from 0 to `maxPaise`, or null. */
export function rupeesToPaise(text: string, maxPaise: number): number | null {
  const v = hundredths(text);
  return v !== null && v <= maxPaise ? v : null;
}

/** A calendar date typed as YYYY-MM-DD, or null (30 February and the like do not exist). */
export function calendarDate(text: string): string | null {
  const t = text.trim();
  const m = DAY.exec(t);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d ? t : null;
}

/** OUR sentence for a field that was not accepted. No number the person typed is repeated. */
export const FIELD_TEXT: Record<FieldName, string> = {
  effective_from: "Starts on: choose a date that exists and is today or later.",
  validity_days: "Days a quote is valid: enter a whole number from 1 to 365, using digits only.",
  new_advance: "Advance for a new customer: enter a percent from 0 to 100, using digits and at most two digits after the point.",
  repeat_advance: "Advance for a repeat customer: enter a percent from 0 to 100, using digits and at most two digits after the point.",
  new_net_days: "Days to pay the balance, new customers: enter a whole number from 0 to 180, using digits only.",
  repeat_net_days: "Days to pay the balance, repeat customers: enter a whole number from 0 to 180, using digits only.",
  gst_rate: "GST rate: enter a percent from 0 to 28, using digits and at most two digits after the point.",
  credit_limit: "Most credit for one repeat customer: enter rupees from 0 to 1,00,00,000, using digits and at most two digits after the point, without commas.",
  seller_state: "State where the shop is: type the two capital letters of the state code on your GST papers.",
  discount_ceiling: "Discount ceiling: enter a percent from 0 to 100, using digits and at most two digits after the point.",
};

export const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";

export type PolicyResult = { ok: true; input: QuotePolicyInput } | { ok: false; error: string };

/**
 * The policy a person typed, as the typed body: the first field that is not acceptable gives its sentence and nothing is built. `today` is the date in India (YYYY-MM-DD): a start date before it is
 * refused here; a start date before the newest published version is for the database to refuse.
 */
export function policyFromForm(values: PolicyValues, id: string, today: string): PolicyResult {
  if (!isCanonicalUuid(id)) return { ok: false, error: OUT_OF_DATE };
  const start = calendarDate(values.effective_from);
  if (start === null || start < today) return { ok: false, error: FIELD_TEXT.effective_from };
  const L = POLICY_LIMITS;
  const validityDays = wholeNumber(values.validity_days, L.validityDays.min, L.validityDays.max);
  if (validityDays === null) return { ok: false, error: FIELD_TEXT.validity_days };
  const newAdvanceBps = percentToBps(values.new_advance);
  if (newAdvanceBps === null) return { ok: false, error: FIELD_TEXT.new_advance };
  const repeatAdvanceBps = percentToBps(values.repeat_advance);
  if (repeatAdvanceBps === null) return { ok: false, error: FIELD_TEXT.repeat_advance };
  const newNetDays = wholeNumber(values.new_net_days, L.netDays.min, L.netDays.max);
  if (newNetDays === null) return { ok: false, error: FIELD_TEXT.new_net_days };
  const repeatNetDays = wholeNumber(values.repeat_net_days, L.netDays.min, L.netDays.max);
  if (repeatNetDays === null) return { ok: false, error: FIELD_TEXT.repeat_net_days };
  const gstRateBps = gstPercentToBps(values.gst_rate);
  if (gstRateBps === null) return { ok: false, error: FIELD_TEXT.gst_rate };
  const repeatCreditLimitPaise = rupeesToPaise(values.credit_limit, L.repeatCreditLimitPaise.max);
  if (repeatCreditLimitPaise === null) return { ok: false, error: FIELD_TEXT.credit_limit };
  const sellerState = values.seller_state.trim();
  if (!STATE.test(sellerState)) return { ok: false, error: FIELD_TEXT.seller_state };
  const discountCeilingBps = percentToBps(values.discount_ceiling);
  if (discountCeilingBps === null) return { ok: false, error: FIELD_TEXT.discount_ceiling };
  return { ok: true, input: { id, effectiveFrom: start, discountCeilingBps, validityDays, newAdvanceBps, repeatAdvanceBps, newNetDays, repeatNetDays, gstRateBps, repeatCreditLimitPaise, sellerState } };
}

// ----------------------------------------------------------------------------- refusals
const SAFE_AGAIN = "Nothing is published twice if you press the button again.";

export type Refusal = { error: string; reason?: "mfa" };

/**
 * ONE sentence of OUR wording for each closed code the policy routes return. Nothing the API, the database or the person typed is repeated. `reason: "mfa"` tells the screen to add the link to the
 * second-factor page.
 */
export function publishRefusal(status: number, code: string): Refusal {
  if (code === "mfa_required") return { reason: "mfa", error: "Publishing a policy needs your authenticator app. Set it up on the Security page, sign in again with its code, and try once more. Nothing was published." };
  if (code === "forbidden") return { error: "Your role cannot publish a quote policy. Only an owner or an admin can." };
  if (code === "validation_error") return { error: "A number or a date was not accepted. Check every field against the limits shown, then try again. Nothing was published." };
  if (code === "invalid_value") return { error: "The start date was not accepted. It cannot be earlier than today or earlier than the start date of the newest published version. Nothing was published." };
  if (code === "conflict") return { error: "This form was already saved with different values. Reload the page and fill it in again. Nothing is published twice." };
  if (code === "not_found" || status === 404) return { error: "This workspace is not available." };
  if (status === 429 || code === "rate_limited") return { error: `Too many requests. Wait a moment and try again. ${SAFE_AGAIN}` };
  if (code === "token_expiring") return { error: "Your session is about to expire. Sign in again, then try once more." };
  if (status === 503 || status === 502 || code === "quotes_unavailable" || code === "upstream_error" || code === "api_unreachable")
    return { error: `Quote policies are not available right now. Try again shortly. ${SAFE_AGAIN}` };
  return { error: `Could not publish this. Try again. ${SAFE_AGAIN}` };
}

/** The sentence after a saved version: the number and the start date, and a replay says so. */
export function publishedSentence(versionNo: number, effectiveFrom: string, replayed: boolean, formatDate: (iso: string) => string): string {
  return replayed
    ? `Version ${versionNo} was already published, starting on ${formatDate(effectiveFrom)}. Nothing was published twice.`
    : `Published version ${versionNo}, starting on ${formatDate(effectiveFrom)}.`;
}
