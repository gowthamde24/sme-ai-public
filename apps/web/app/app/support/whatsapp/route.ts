import { type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/session";
import { BRAND_NAME } from "@/design/brand";
import { chatAddress, ourWhatsappDigits } from "@/lib/site/whatsapp";

export const dynamic = "force-dynamic";

const SCREENS = ["myassistant", "calls", "chats", "leads", "campaigns", "reports", "billing", "phone", "today", "catalogue", "settings"];

/**
 * GET /app/support/whatsapp?page=<screen> (design system v6, owner 13 Nov 2026): the "?" of a page offers a chat with OUR support on WhatsApp. It answers a 302 to our own public number with one fixed sentence (the screen's name from a closed list, nothing else from the request), so no
 * number is in any page and nothing typed by the person reaches the address. Signed-in people only. THIS SYSTEM SENDS NOTHING: the person presses send in their own WhatsApp.
 */
export async function GET(request: NextRequest) {
  await requireUser();
  const page = request.nextUrl.searchParams.get("page") ?? "";
  const screen = SCREENS.includes(page) ? page : "the app";
  const digits = ourWhatsappDigits();
  const url = digits === null ? null : chatAddress(digits, `Hi ${BRAND_NAME} support, I need help with ${screen}.`);
  if (url === null) return new Response("Not available right now.", { status: 503, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", Location: url } });
}
