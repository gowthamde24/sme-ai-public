import { ApiAuthError } from "@/lib/api/client";
import { fetchLeadFollowup } from "@/lib/api/followups";
import { fetchLeadContactId } from "@/lib/api/lead-contact";
import type { Quote, QuoteText } from "@/lib/api/quotes";
import { GATE_CODES, whatsappCode, type WhatsappCode } from "@/lib/whatsapp/codes";
import { quoteExpired } from "@/lib/whatsapp/expiry";
import { fitsInLink } from "@/lib/whatsapp/limit";

/**
 * What the quote screen needs to decide which WhatsApp controls to show for an APPROVED quote. It holds no phone number and no text from the API: only closed words, booleans and ids. The number itself is read only by the redirect
 * route (docs/plans/open-in-whatsapp-plan.md, section 2).
 *
 *   - `gate`: "open" (the database's own gate for WhatsApp lets the channel through), one of the gate words (`consent | contact | key | erased | unkeyed`), or "unread" (it could not be read right now)
 *   - `consentContactId`: the lead's contact, only when the gate word is `consent`, to link to the consent page
 *   - `notice`: the closed code the redirect route sent the person back with (`?whatsapp=`), if any
 */
export type WhatsappView = {
  leadId: string;
  expired: boolean;
  validUntil: string;
  fits: boolean;
  gate: "open" | (typeof GATE_CODES)[number] | "unread";
  policyInForce: boolean | null;
  consentContactId: string | null;
  notice: WhatsappCode | null;
};

/** Never throws except for an expired session (`ApiAuthError`), which the page turns into the login redirect. A read that fails makes the gate "unread": the controls are then not offered. */
export async function loadWhatsappView(accessToken: string, tenantId: string, quote: Quote, text: QuoteText, rawNotice: string | string[] | undefined, now: Date): Promise<WhatsappView> {
  const base: WhatsappView = {
    leadId: quote.lead_id,
    expired: quoteExpired(quote.valid_until, now),
    validUntil: quote.valid_until,
    fits: fitsInLink(text.text),
    gate: "unread",
    policyInForce: null,
    consentContactId: null,
    notice: whatsappCode(rawNotice),
  };
  if (base.expired) return base;
  try {
    const lead = await fetchLeadFollowup(accessToken, tenantId, quote.lead_id, "whatsapp");
    if (lead.channel !== "whatsapp") return base;
    base.policyInForce = lead.gate.policy_in_force;
    const word = lead.gate.blocked;
    if (word === null) base.gate = "open";
    else if ((GATE_CODES as readonly string[]).includes(word)) base.gate = word as (typeof GATE_CODES)[number];
    else return base;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return base;
  }
  if (base.gate === "consent") {
    try {
      base.consentContactId = await fetchLeadContactId(accessToken, tenantId, quote.lead_id);
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
    }
  }
  return base;
}
