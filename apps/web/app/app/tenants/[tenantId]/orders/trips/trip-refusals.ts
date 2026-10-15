import { photoErrorKey } from "@/components/v2/app/catalogue/photo-errors";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

/**
 * Why a delivery step was refused, as ONE sentence of OUR wording chosen by the API's closed status and code (job CO). Nothing from the server's text is shown. `mfa` = the second factor is missing, `stale` = the screen
 * is out of date. A rejected session is thrown again so the page can send the person to sign in.
 */
export type TripRefusal = { key: string; mfa?: boolean; stale?: boolean };

const BY_CODE: Record<string, TripRefusal> = {
  mfa_required: { key: "today.err.mfa", mfa: true },
  forbidden: { key: "today.err.role" },
  trip_state: { key: "trip.err.state", stale: true },
  order_not_dispatched: { key: "trip.err.notdispatched" },
  quantity_exceeds_order: { key: "trip.err.exceeds" },
  order_not_deliverable: { key: "trip.err.notdeliverable" },
  no_site_contact: { key: "trip.err.nocontact" },
  proof_incomplete: { key: "trip.err.proof" },
  deliveries_unavailable: { key: "trip.err.unavailable" },
  outbox_unavailable: { key: "trip.err.unavailable" },
  module_off: { key: "mat.err.moduleoff" },
  validation_error: { key: "trip.err.invalid" },
  invalid_reference: { key: "trip.err.invalid" },
  not_found: { key: "today.err.state", stale: true },
  customer_stopped: { key: "today.err.stopped" },
};

export function tripRefusalOf(error: unknown): TripRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const known = BY_CODE[error.code];
    if (known) return known;
    if (error.code.startsWith("photo_")) return { key: photoErrorKey(error.code) };
    if (error.status === 403) return { key: "today.err.role" };
    if (error.status === 404) return { key: "today.err.state", stale: true };
    if (error.status === 503) return { key: "trip.err.unavailable" };
  }
  return { key: "today.err.generic" };
}
