import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { photoErrorKey } from "@/components/v2/app/catalogue/photo-errors";

/**
 * Why a catalogue change was refused, as ONE sentence of OUR wording chosen by the API's closed status and code (job BC). Nothing from the server's text is shown. `mfa` = the second factor is missing (the
 * form points at the Security page), `stale` = the screen is out of date. A rejected session is not a refusal: it is thrown again so the page can send the person to sign in.
 * `context` says what was being done, because the same code means different things: the exact price (`price`), taking a photo off (`remove`), anything else (`save`).
 */
export type Refusal = { key: string; mfa?: boolean; stale?: boolean };
export type Context = "save" | "price" | "remove" | "send" | "search";

export function refusalOf(error: unknown, context: Context = "save"): Refusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "mfa_required":
        return { key: "today.err.mfa", mfa: true };
      case "forbidden":
        return { key: context === "price" ? "catalogue.err.price_owner" : "today.err.role" };
      case "needs_photo":
        return { key: context === "remove" ? "catalogue.err.last_photo" : "catalogue.err.needs_photo" };
      case "customer_stopped":
        return { key: "today.err.stopped" };
      case "invalid_reference":
        return { key: context === "send" ? "catalogue.err.send.photo" : "catalogue.err.invalid" };
      case "validation_error":
        return { key: "catalogue.err.invalid" };
      case "catalogue_unavailable":
      case "outbox_unavailable":
        return { key: "catalogue.err.unavailable" };
      case "too_many_photos":
      case "photo_files_missing":
      case "photo_type_unsupported":
      case "photo_too_large":
      case "photo_unreadable":
      case "photo_too_big":
      case "photo_animated":
        return { key: photoErrorKey(error.code) };
    }
    if (error.status === 403) return { key: "today.err.role" };
    if (error.status === 404) return { key: "today.err.state", stale: true };
    if (error.status === 503) return { key: "catalogue.err.unavailable" };
  }
  return { key: "today.err.generic" };
}
