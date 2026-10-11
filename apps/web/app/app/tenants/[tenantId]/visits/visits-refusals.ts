import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

/**
 * Why a visit step was refused, as ONE sentence of OUR wording chosen by the API's closed status and code (job AV). Nothing from the server's text is shown. `mfa` = the second factor is missing (the card
 * points at the Security page), `quotes` = "bought" found no approved quote (the card points at the quotes), `stale` = the screen is out of date (the page is read again). A rejected session is not a
 * refusal: it is thrown again so the page can send the person to sign in.
 */
export type Refusal = { key: string; mfa?: boolean; quotes?: boolean; stale?: boolean };

const BY_CODE: Record<string, Refusal> = {
  forbidden: { key: "today.err.role" },
  mfa_required: { key: "today.err.mfa", mfa: true },
  not_found: { key: "today.err.state", stale: true },
  visit_state: { key: "visits.err.state", stale: true },
  shop_closed: { key: "visits.err.shop_closed" },
  slot_invalid: { key: "visits.err.slot_invalid" },
  slot_full: { key: "visits.err.slot_full", stale: true },
  date_past: { key: "visits.err.date_past" },
  customer_erased: { key: "visits.err.erased" },
  conflict: { key: "visits.err.conflict" },
  no_approved_quote: { key: "visits.err.no_quote", quotes: true },
  order_exists: { key: "visits.err.order_exists" },
  quote_expired: { key: "visits.err.quote_expired", quotes: true },
  quote_not_approved: { key: "visits.err.order_other", quotes: true },
  order_figures_invalid: { key: "visits.err.order_other" },
  no_order_policy: { key: "visits.err.order_other" },
  validation_error: { key: "visits.err.invalid" },
  invalid_value: { key: "visits.err.invalid" },
  invalid_reference: { key: "visits.err.invalid" },
  visits_unavailable: { key: "visits.err.unavailable" },
  outbox_unavailable: { key: "visits.err.unavailable" },
  outbox_state: { key: "today.err.state", stale: true },
};

export function refusalOf(error: unknown): Refusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const known = BY_CODE[error.code];
    if (known) return known;
    if (error.status === 403) return { key: "today.err.role" };
    if (error.status === 404) return { key: "today.err.state", stale: true };
    if (error.status === 503) return { key: "visits.err.unavailable" };
  }
  return { key: "today.err.generic" };
}
