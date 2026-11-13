import { notFound, redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchContactPhone } from "@/lib/api/contact-phone";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchLeadFollowup } from "@/lib/api/followups";
import { fetchLeadContactId } from "@/lib/api/lead-contact";
import { getOutboxMessage, type OutboxMessage } from "@/lib/api/outbox";
import { approvedNotSent } from "@/lib/api/outbox-approved";
import { requireUser } from "@/lib/auth/session";
import { outboxWhatsappScreens } from "@/lib/screens/flag";
import { GATE_CODES, type WhatsappCode } from "@/lib/whatsapp/codes";
import { fitsInLink } from "@/lib/whatsapp/limit";
import { whatsappDigits, whatsappUrl } from "@/lib/whatsapp/link";

export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin"];
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /app/tenants/[tenantId]/outbox/[messageId]/whatsapp[?chat=1]: "Open in WhatsApp" for a message of the Outbox that the person approved (owner 13 Nov 2026, behind OUTBOX_WHATSAPP; the second of the TWO redirect routes the guard allows, the other is the quote's).
 * It answers a 302 to `https://wa.me/<number>?text=<the message's words>`, or, with `chat=1`, to the chat alone. THIS SYSTEM SENDS NOTHING: the person presses send in their own WhatsApp.
 *
 * Built like the quote route: the phone number is read here, on the server, with the person's own token, and appears in exactly one place, the `Location` of that one redirect. A failure is never a page of text: it is a redirect back to the Outbox carrying ONE closed
 * code (`?whatsapp=<code>`, lib/whatsapp/codes.ts). The route trusts nothing from the browser but the two ids in the path and the `chat` flag; the lead, the contact, the number and the words all come from the message on the server.
 *
 * Order of checks: the flag (404 when off); a signed-in person (login redirect); the ids (404); the workspace and the role (404; 403: Owner and Admin only); the message (404); that the click came from this site's own page (Sec-Fetch-Site `same-origin` or `none`, else `not_from_here`);
 * that the message is approved and not sent; the database's own gate for WhatsApp; the words and whether they fit; and only then the number.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; messageId: string }> }) {
  if (outboxWhatsappScreens() === "off") notFound();
  const user = await requireUser();
  const { tenantId, messageId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(messageId)) notFound();

  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return new Response("Not available right now.", { status: 503, headers: NO_STORE });
  }
  if (!WRITE_ROLES.includes(role)) return new Response("Your role cannot do this.", { status: 403, headers: NO_STORE });

  let message: OutboxMessage;
  try {
    message = await getOutboxMessage(user.accessToken, tenantId, messageId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    return new Response("Not available right now.", { status: 503, headers: NO_STORE });
  }

  const back = (code: WhatsappCode) =>
    new Response(null, { status: 302, headers: { ...NO_STORE, Location: `/app/tenants/${tenantId}/outbox?tab=scheduled&whatsapp=${code}` } });

  const site = request.headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") return back("not_from_here");
  if (!approvedNotSent(message)) return back("not_approved");

  try {
    const lead = await fetchLeadFollowup(user.accessToken, tenantId, message.lead_id, "whatsapp");
    if (lead.channel !== "whatsapp") return back("unavailable");
    if (lead.gate.blocked !== null) return back((GATE_CODES as readonly string[]).includes(lead.gate.blocked) ? (lead.gate.blocked as WhatsappCode) : "unavailable");

    const chatOnly = request.nextUrl.searchParams.get("chat") === "1";
    if (!chatOnly && !fitsInLink(message.text)) return back("too_long");

    const contactId = await fetchLeadContactId(user.accessToken, tenantId, message.lead_id);
    const stored = contactId === null ? null : await fetchContactPhone(user.accessToken, tenantId, contactId);
    if (stored === null) return back("no_phone");
    const digits = whatsappDigits(stored);
    if (digits === null) return back("bad_number");
    const url = whatsappUrl(digits, chatOnly ? null : message.text);
    if (url === null) return back("too_long");

    return new Response(null, { status: 302, headers: { ...NO_STORE, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", Location: url } });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return back("unavailable");
  }
}
