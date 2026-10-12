import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { TouchChannel } from "@/lib/api/followups";
import { makeT, type Say } from "@/components/v2/app/words";

/**
 * Shared by the two places that record "I sent a message" as an outgoing touch: the lead page (leads/[leadId]/sent-message-actions.ts) and the approved quote (enquiries/sent-on-whatsapp-actions.ts). A plain module, not a
 * "use server" file, so it may export a constant and a type next to the function. The wording is item g's, moved here unchanged.
 */
/**
 * What the screen shows after a press. `ok` carries the channel and the time that were recorded (an ISO instant); a refusal carries one sentence of OUR wording and, when the reason is consent,
 * `reason: "consent"` so the screen can point at the consent page. Never a phone number, an e-mail address or any text from the API.
 */
export type SentMessageState = { ok?: boolean; error?: string; reason?: "consent"; channel?: TouchChannel; at?: string } | undefined;

export const NOT_AVAILABLE = "This lead is not available.";

/** The person's own words for a refusal of the database, chosen by the API's closed code and reason. Nothing from the server's text is used. */
export function sentRefusal(error: unknown, notAvailable?: string, t: Say = makeT()): SentMessageState {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    const { status, code, reason } = error;
    if (code === "contact_blocked") {
      switch (reason) {
        case "contact":
          return { ok: false, error: t("fu.this_person_has_asked_not_to") };
        case "key":
        case "erased_key":
          return { ok: false, error: t("fu.this_phone_number_or_e_mail") };
        case "erased":
          return { ok: false, error: t("fu.this_person_s_details_were_erased") };
        case "consent":
          return {
            ok: false,
            reason: "consent",
            error: t("fu.there_is_no_recorded_consent_for"),
          };
        default:
          return { ok: false, error: t("fu.this_person_cannot_be_contacted_so") };
      }
    }
    if (code === "no_suppression_key")
      return { ok: false, error: t("fu.this_person_s_number_or_e") };
    if (code === "no_followup_policy") return { ok: false, error: t("fu.no_follow_up_policy_is_in") };
    if (code === "followup_limit") return { ok: false, error: t("fu.this_lead_has_reached_the_limit") };
    if (code === "token_expiring") return { ok: false, error: t("fu.your_session_is_about_to_expire") };
    if (code === "conflict") return { ok: false, error: t("fu.this_was_already_recorded_with_a") };
    if (code === "invalid_value" || code === "validation_error")
      return { ok: false, error: t("fu.that_channel_or_time_was_not") };
    if (status === 403) return { ok: false, error: t("fu.your_role_cannot_record_that_a") };
    if (status === 404) return { ok: false, error: notAvailable ?? t("fu.lead_not_available") };
    if (status === 429) return { ok: false, error: t("fu.too_many") };
    if (status === 503 || code === "followups_unavailable" || code === "followup_cadence_unavailable") return { ok: false, error: t("fu.not_available_now") };
  }
  return { ok: false, error: t("fu.could_not_record") };
}
