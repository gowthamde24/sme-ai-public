import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

/**
 * Why a campaign step was refused, as ONE sentence of OUR wording chosen by the API's closed status and code (job CQ). Nothing from the server's text is shown. `mfa` = the second factor is missing (the screen points at
 * the Security page); `changed` = the campaign changed since the samples were read (they are read again). A rejected session is thrown again so the page can send the person to sign in.
 */
export type CampaignRefusal = { key: string; mfa?: boolean; changed?: boolean };
const BY_CODE: Record<string, CampaignRefusal> = {
  mfa_required: { key: "today.err.mfa", mfa: true },
  forbidden: { key: "today.err.role" },
  samples_changed: { key: "camp.err.changed", changed: true },
  campaign_not_ready: { key: "camp.err.notready" },
  campaign_state: { key: "camp.err.state" },
  not_in_a_state_for_this: { key: "camp.err.callstate" },
  outside_calling_hours: { key: "camp.err.hours" },
  customer_phone_unusable: { key: "camp.err.phone" },
  call_provider_failed: { key: "camp.err.callfailed" },
  module_off: { key: "mat.err.moduleoff" },
  validation_error: { key: "camp.err.invalid" },
  invalid_reference: { key: "camp.err.invalid" },
  too_many_recipients: { key: "camp.err.toomany" },
};
export function campaignRefusalOf(error: unknown): CampaignRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const known = BY_CODE[error.code];
    if (known) return known;
    if (error.status === 403) return { key: "today.err.role" };
    if (error.status === 404 || error.status === 409) return { key: "today.err.state" };
    if (error.status === 422) return { key: "camp.err.invalid" };
    if (error.status === 503) return { key: "camp.err.unavailable" };
  }
  return { key: "today.err.generic" };
}
