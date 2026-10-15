import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

/**
 * Why a material-quote step was refused, as ONE sentence of OUR wording chosen by the API's closed status, code and reason (job CO). Nothing from the server's text is shown. `mfa` = the second factor is missing (the
 * card points at the Security page), `stale` = the screen is out of date (the page is read again), `owner` = a flagged quote is the Owner's alone. A rejected session is not a refusal: it is thrown again so the page
 * can send the person to sign in.
 */
export type MaterialRefusal = { key: string; mfa?: boolean; stale?: boolean; owner?: boolean };

const MISSING = ["pick", "measure", "product_type", "price", "gst_rate", "pieces_per_area", "unit", "hsn", "policy", "duplicate_item"];
const CALC = ["LAYING_RATE_MISSING", "DISTANCE_MISSING", "DISTANCE_BEYOND_SLABS", "TOTAL_TOO_LARGE", "OUT_OF_RANGE"];

const BY_CODE: Record<string, MaterialRefusal> = {
  mfa_required: { key: "today.err.mfa", mfa: true },
  forbidden: { key: "today.err.role" },
  owner_approval_required: { key: "mat.err.owner", owner: true },
  quote_mismatch: { key: "mat.err.stale", stale: true },
  quote_stale: { key: "mat.err.stale", stale: true },
  quote_not_draft: { key: "mat.err.notdraft", stale: true },
  calculator_disagreement: { key: "mat.err.disagree" },
  materials_unavailable: { key: "mat.err.unavailable" },
  catalogue_unavailable: { key: "mat.err.unavailable" },
  module_off: { key: "mat.err.moduleoff" },
  validation_error: { key: "mat.err.invalid" },
  invalid_reference: { key: "mat.err.invalid" },
  not_found: { key: "today.err.state", stale: true },
  no_order_policy: { key: "mat.err.order.policy" },
  quote_not_approved: { key: "mat.err.order.notapproved", stale: true },
  order_exists: { key: "mat.err.order.exists" },
  quote_expired: { key: "mat.err.order.expired", stale: true },
  order_figures_invalid: { key: "mat.err.order.other" },
};

export function materialRefusalOf(error: unknown): MaterialRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.code === "quote_input_missing") return { key: `mat.err.missing.${error.reason && MISSING.includes(error.reason) ? error.reason : "other"}` };
    if (error.code === "quote_not_computable") return { key: `mat.err.calc.${error.reason && CALC.includes(error.reason) ? error.reason : "other"}` };
    const known = BY_CODE[error.code];
    if (known) return known;
    if (error.status === 403) return { key: "today.err.role" };
    if (error.status === 404) return { key: "today.err.state", stale: true };
    if (error.status === 503) return { key: "mat.err.unavailable" };
  }
  return { key: "today.err.generic" };
}
