"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { TOUCH_CHANNELS, recordTouch, type TouchChannel } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { touchTime } from "../../followups/followup-logic";

/**
 * What the screen shows after a press. `ok` carries the channel and the time that were recorded (an ISO instant); a refusal carries one sentence of OUR wording and, when the reason is consent,
 * `reason: "consent"` so the screen can point at the consent page. Never a phone number, an e-mail address or any text from the API.
 */
export type SentMessageState = { ok?: boolean; error?: string; reason?: "consent"; channel?: TouchChannel; at?: string } | undefined;

const NOT_AVAILABLE = "This lead is not available.";
const SAFE_AGAIN = "Nothing is recorded twice if you press the button again.";

/** The person's own words for a refusal of the database, chosen by the API's closed code and reason. Nothing from the server's text is used. */
function refusal(error: unknown): SentMessageState {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    const { status, code, reason } = error;
    if (code === "contact_blocked") {
      switch (reason) {
        case "contact":
          return { ok: false, error: "This person has asked not to be contacted, so a message to them cannot be recorded as sent." };
        case "key":
        case "erased_key":
          return { ok: false, error: "This phone number or e-mail is on the do-not-contact list, so a message to it cannot be recorded as sent." };
        case "erased":
          return { ok: false, error: "This person's details were erased, so nothing new can be recorded about them." };
        case "consent":
          return {
            ok: false,
            reason: "consent",
            error: "There is no recorded consent for this channel, or this person has no number or e-mail for it. Record consent first, or check their details. Nothing was recorded.",
          };
        default:
          return { ok: false, error: "This person cannot be contacted, so nothing was recorded." };
      }
    }
    if (code === "no_suppression_key")
      return { ok: false, error: "This person's number or e-mail has no suppression key yet, so nothing can be recorded as sent. The owner records keys on the Suppression keys page." };
    if (code === "no_followup_policy") return { ok: false, error: "No follow-up policy is in force. The owner must publish one before follow-ups can start." };
    if (code === "followup_limit") return { ok: false, error: "This lead has reached the limit of recorded touches." };
    if (code === "token_expiring") return { ok: false, error: "Your session is about to expire. Sign in again, then try once more." };
    if (code === "conflict") return { ok: false, error: "This was already recorded with a different channel or time. Reload the page and look at the lead's follow-up before recording again." };
    if (code === "invalid_value" || code === "validation_error")
      return { ok: false, error: "That channel or time was not accepted. A time cannot be in the future, more than 7 days back, or before this lead was made. Leave it empty for now." };
    if (status === 403) return { ok: false, error: "Your role cannot record that a message was sent." };
    if (status === 404) return { ok: false, error: NOT_AVAILABLE };
    if (status === 429) return { ok: false, error: `Too many requests. Wait a moment and try again. ${SAFE_AGAIN}` };
    if (status === 503 || code === "followups_unavailable" || code === "followup_cadence_unavailable") return { ok: false, error: `Follow-ups are not available right now. Try again shortly. ${SAFE_AGAIN}` };
  }
  return { ok: false, error: `Could not record this. Try again. ${SAFE_AGAIN}` };
}

/**
 * "I sent a message": a person records an OUTGOING touch, a message they sent themselves, outside this system. Only outgoing is offered here (the direction is fixed in this function, never read from
 * the form). The channel has no default and is required; the time is optional (empty means now; never in the future; the database allows at most 7 days back). The id comes from the page, so an
 * identical retry replays. Nothing is sent by this system. The database decides every refusal; nothing is fixed silently.
 */
export async function recordSentMessageAction(tenantId: string, leadId: string, _prev: SentMessageState, formData: FormData): Promise<SentMessageState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: NOT_AVAILABLE };
  const idRaw = formData.get("touch_id");
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!isCanonicalUuid(id)) return { ok: false, error: "This form is out of date. Reload the page and try again." };
  const channelRaw = formData.get("channel");
  const channel = typeof channelRaw === "string" ? channelRaw.trim() : "";
  if (!(TOUCH_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: "Choose the channel." };
  const whenRaw = formData.get("happened_at");
  const now = new Date();
  const when = touchTime(typeof whenRaw === "string" ? whenRaw : "", now);
  if (!when.ok) return { ok: false, error: when.error };
  try {
    await recordTouch(user.accessToken, tenantId, leadId, { id, direction: "out", channel: channel as TouchChannel, ...(when.value ? { occurredAt: when.value } : {}) });
  } catch (error) {
    return refusal(error);
  }
  // The follow-up page and the due list read this touch. The LEAD page is not revalidated: it would re-render with a new id and hide the success message.
  revalidatePath(`/app/tenants/${tenantId}/leads/${leadId}/followup`);
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, channel: channel as TouchChannel, at: when.value ?? now.toISOString() };
}
