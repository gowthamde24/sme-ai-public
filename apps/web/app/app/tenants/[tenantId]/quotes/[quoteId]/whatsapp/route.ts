import { notFound, redirect } from "next/navigation";
import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchContactPhone } from "@/lib/api/contact-phone";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchLeadFollowup } from "@/lib/api/followups";
import { fetchLeadContactId } from "@/lib/api/lead-contact";
import { fetchQuote, fetchQuoteText, type Quote } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";
import { GATE_CODES, type WhatsappCode } from "@/lib/whatsapp/codes";
import { quoteExpired } from "@/lib/whatsapp/expiry";
import { fitsInLink } from "@/lib/whatsapp/limit";
import { whatsappDigits, whatsappUrl } from "@/lib/whatsapp/link";

export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin", "sales"];
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /app/tenants/[tenantId]/quotes/[quoteId]/whatsapp[?chat=1]: "Open in WhatsApp" for an approved quote (docs/plans/open-in-whatsapp-plan.md). It answers a 302 to `https://wa.me/<number>?text=<the approved quote text>`,
 * or, with `chat=1`, to the chat alone. THIS SYSTEM SENDS NOTHING: the person presses send in their own WhatsApp.
 *
 * The phone number is read here, on the server, with the person's own token, and appears in exactly one place: the `Location` of that one redirect. A failure is never a page of text: it is a redirect back to the quote screen
 * carrying ONE closed code (`?whatsapp=<code>`, lib/whatsapp/codes.ts), so neither a number, nor a name, nor any text from the API or the database can reach a response. The route trusts nothing from the browser but the two ids in the path
 * and the `chat` flag; the lead, the contact, the number and the text all come from the quote on the server.
 *
 * Order of checks: a signed-in person (login redirect); the ids (404); the workspace and the role (404, 403: a viewer sees no quote screen); the quote (404); that the click came from this site's own page (Sec-Fetch-Site must be
 * `same-origin` or `none`: otherwise back with `not_from_here`); that the quote is approved and not expired; the database's own gate for WhatsApp; the text and whether it fits; and only then the number.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; quoteId: string }> }) {
  const user = await requireUser();
  const { tenantId, quoteId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(quoteId)) notFound();

  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return new Response("Not available right now.", { status: 503, headers: NO_STORE });
  }
  if (!WRITE_ROLES.includes(role)) return new Response("Your role cannot do this.", { status: 403, headers: NO_STORE });

  let quote: Quote;
  try {
    quote = await fetchQuote(user.accessToken, tenantId, quoteId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) notFound();
    return new Response("Not available right now.", { status: 503, headers: NO_STORE });
  }

  const back = (code: WhatsappCode) =>
    new Response(null, {
      status: 302,
      headers: { ...NO_STORE, Location: `/app/tenants/${tenantId}/enquiries/${quote.enquiry_id}?quote=${quote.id}&whatsapp=${code}` },
    });

  const site = request.headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") return back("not_from_here");
  if (quote.outcome !== "approved") return back("not_approved");
  if (quoteExpired(quote.valid_until, new Date())) return back("expired");

  try {
    const lead = await fetchLeadFollowup(user.accessToken, tenantId, quote.lead_id, "whatsapp");
    if (lead.channel !== "whatsapp") return back("unavailable");
    if (lead.gate.blocked !== null) return back((GATE_CODES as readonly string[]).includes(lead.gate.blocked) ? (lead.gate.blocked as WhatsappCode) : "unavailable");

    const text = (await fetchQuoteText(user.accessToken, tenantId, quote.id)).text;
    const chatOnly = request.nextUrl.searchParams.get("chat") === "1";
    if (!chatOnly && !fitsInLink(text)) return back("too_long");

    const contactId = await fetchLeadContactId(user.accessToken, tenantId, quote.lead_id);
    const stored = contactId === null ? null : await fetchContactPhone(user.accessToken, tenantId, contactId);
    if (stored === null) return back("no_phone");
    const digits = whatsappDigits(stored);
    if (digits === null) return back("bad_number");
    const url = whatsappUrl(digits, chatOnly ? null : text);
    if (url === null) return back("too_long");

    return new Response(null, { status: 302, headers: { ...NO_STORE, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", Location: url } });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 409 && error.code === "quote_not_approved") return back("not_approved");
    return back("unavailable");
  }
}
