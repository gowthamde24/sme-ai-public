"use server";

import { revalidatePath } from "next/cache";

import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { recordTouch } from "@/lib/api/followups";
import { fetchQuote } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";
import { quoteExpired } from "@/lib/whatsapp/expiry";

import { sentRefusal, type SentMessageState } from "../followups/sent-refusal";
import { serverT } from "@/i18n/server-t";

export type { SentMessageState };

/**
 * "I sent it on WhatsApp" on an APPROVED quote: a person records that they sent the quote themselves, in their own WhatsApp, outside this system. It records one OUTGOING touch on the quote's lead (the same record as "I sent a message"
 * on the lead page, which starts the follow-up clock). Nothing is sent by this system.
 *
 * What the action trusts: the workspace id and the QUOTE id from the page, and the touch id the page made for this render (an identical retry replays). It takes the lead from the quote itself, read on the server with the person's
 * own token, never from the form. The direction is fixed to outgoing and the channel to WhatsApp here; every other field of the form is ignored. It refuses unless the quote is approved and not past its valid-until date. The time is the
 * database's "now". The database decides every other refusal (consent, suppression, role), and its wording is the shared one (followups/sent-refusal.ts). The answer never carries a phone number, an address or text from the API.
 */
export async function recordQuoteSentAction(tenantId: string, quoteId: string, _prev: SentMessageState, formData: FormData): Promise<SentMessageState> {
  const t = await serverT(["enq.", "fu."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId)) return { ok: false, error: t("enq.quote_not_available") };
  const idRaw = formData.get("touch_id");
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!isCanonicalUuid(id)) return { ok: false, error: t("enq.this_form_is_out_of_date") };
  let leadId: string;
  try {
    const quote = await fetchQuote(user.accessToken, tenantId, quoteId);
    if (quote.outcome !== "approved") return { ok: false, error: t("enq.this_quote_is_not_approved_any") };
    if (quoteExpired(quote.valid_until, new Date())) return { ok: false, error: t("enq.this_quote_has_expired_so_nothing") };
    leadId = quote.lead_id;
  } catch (error) {
    if (error instanceof ApiAuthError) return sentRefusal(error, undefined, t);
    return sentRefusal(error, t("enq.quote_not_available"), t);
  }
  const now = new Date();
  try {
    await recordTouch(user.accessToken, tenantId, leadId, { id, direction: "out", channel: "whatsapp" });
  } catch (error) {
    return sentRefusal(error, t("enq.quote_not_available"), t);
  }
  // The follow-up page and the due list read this touch. The quote page is not revalidated: it would re-render with a new id and hide the success message.
  revalidatePath(`/app/tenants/${tenantId}/leads/${leadId}/followup`);
  revalidatePath(`/app/tenants/${tenantId}/followups`);
  return { ok: true, channel: "whatsapp", at: now.toISOString() };
}
