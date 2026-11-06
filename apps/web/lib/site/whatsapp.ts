import { BRAND_NAME } from "@/design/brand";

/**
 * OUR WhatsApp number, for "Open WhatsApp" on the public site (job CM). It is configuration, not data a visitor gave: `STACK19_WHATSAPP` (digits with the country code, for example 919876543210) is read on the server only, so
 * the number is not in the page's HTML until a visitor has ticked consent and asked for the chat (and a script reading the pages does not collect it). When it is not set the site says so and shows no chat button. This file is
 * not the number rule of the quote screen (lib/whatsapp/link.ts, which only its redirect route may import): that one turns a customer's stored number into a link; this one holds our own public number.
 */
const DIGITS = /^[1-9][0-9]{7,14}$/;

export function ourWhatsappDigits(raw: string | undefined = process.env.STACK19_WHATSAPP): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s+().-]/g, "");
  return DIGITS.test(digits) ? digits : null;
}

/** The chat address with the message filled in (percent-encoded whole). A message too long for a link is refused (null). */
export function chatAddress(digits: string, text: string): string | null {
  if (!DIGITS.test(digits) || text.length === 0 || encodeURIComponent(text).length > 1500) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Is the chat button available on this system at all? */
export const chatAvailable = (): boolean => ourWhatsappDigits() !== null;

/**
 * OUR number as the home page shows it, in its footer and its closing line (owner, 6 Nov 2026): the one place to change it. The strings say `{whatsapp}` and the page draws this number there, linked to a chat with
 * a short message filled in. Nothing else on the site uses it: the contact page's chat keeps STACK19_WHATSAPP above, and no structured data or meta tag carries it.
 */
export const SITE_WHATSAPP = "+91 95023 80998";

/** The footer's chat link: our number, with "Hi <brand>, I'd like early access." filled in. */
export function siteWhatsappHref(): string {
  const digits = SITE_WHATSAPP.replace(/\D/g, "");
  return chatAddress(digits, `Hi ${BRAND_NAME}, I'd like early access.`) ?? `https://wa.me/${digits}`;
}
