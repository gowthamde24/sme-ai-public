"use server";

import { revalidatePath } from "next/cache";

import { isCanonicalUuid } from "@/lib/api/crm";
import { TOUCH_CHANNELS, recordTouch, type TouchChannel } from "@/lib/api/followups";
import { requireUser } from "@/lib/auth/session";

import { touchTime } from "../../followups/followup-logic";
import { sentRefusal, type SentMessageState } from "../../followups/sent-refusal";
import { serverT } from "@/i18n/server-t";

export type { SentMessageState };

/**
 * "I sent a message": a person records an OUTGOING touch, a message they sent themselves, outside this system. Only outgoing is offered here (the direction is fixed in this function, never read from
 * the form). The channel has no default and is required; the time is optional (empty means now; never in the future; the database allows at most 7 days back). The id comes from the page, so an
 * identical retry replays. Nothing is sent by this system. The database decides every refusal; nothing is fixed silently.
 */
export async function recordSentMessageAction(tenantId: string, leadId: string, _prev: SentMessageState, formData: FormData): Promise<SentMessageState> {
  const t = await serverT(["lead.", "fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: t("fu.lead_not_available") };
  const idRaw = formData.get("touch_id");
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!isCanonicalUuid(id)) return { ok: false, error: t("lead.this_form_is_out_of_date") };
  const channelRaw = formData.get("channel");
  const channel = typeof channelRaw === "string" ? channelRaw.trim() : "";
  if (!(TOUCH_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: t("lead.choose_the_channel") };
  const whenRaw = formData.get("happened_at");
  const now = new Date();
  const when = touchTime(typeof whenRaw === "string" ? whenRaw : "", now);
  if (!when.ok) return { ok: false, error: when.error };
  try {
    await recordTouch(user.accessToken, tenantId, leadId, { id, direction: "out", channel: channel as TouchChannel, ...(when.value ? { occurredAt: when.value } : {}) });
  } catch (error) {
    return sentRefusal(error, undefined, t);
  }
  // The follow-up page and the due list read this touch. The LEAD page is not revalidated: it would re-render with a new id and hide the success message.
  revalidatePath(`/app/tenants/${tenantId}/leads/${leadId}/followup`);
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, channel: channel as TouchChannel, at: when.value ?? now.toISOString() };
}
