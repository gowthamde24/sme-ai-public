import { BRAND_NAME } from "@/design/brand";

/**
 * OUR WhatsApp number (owner, 6 Nov 2026): the ONE place it is set, for the whole public site. The home page shows it in its footer and closing line (the strings say `{whatsapp}`), and the contact form and the
 * business pages' calculator open a chat to it. On those two the number goes into the chat link only after the visitor has ticked consent and asked for the chat (job CM: the server action builds the link). No
 * structured data or meta tag carries it. It replaced the STACK19_WHATSAPP setting, which was never set on any service. This file is not the number rule of the quote screen (lib/whatsapp/link.ts, which only its
 * redirect route may import): that one turns a customer's stored number into a link; this one holds our own public number.
 */
export const SITE_WHATSAPP = "+91 95023 80998";

const DIGITS = /^[1-9][0-9]{7,14}$/;

/** A number as digits with the country code (spaces, "+", brackets and dashes dropped), or null when it is not one. By default: ours. */
export function ourWhatsappDigits(raw: string | undefined = SITE_WHATSAPP): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s+().-]/g, "");
  return DIGITS.test(digits) ? digits : null;
}

/** The chat address with the message filled in (percent-encoded whole). A message too long for a link is refused (null). */
export function chatAddress(digits: string, text: string): string | null {
  if (!DIGITS.test(digits) || text.length === 0 || encodeURIComponent(text).length > 1500) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Is the chat button available at all? (Always, while SITE_WHATSAPP is a number.) */
export const chatAvailable = (): boolean => ourWhatsappDigits() !== null;

/** The footer's chat link: our number, with "Hi <brand>, I'd like early access." filled in. */
export function siteWhatsappHref(): string {
  const digits = ourWhatsappDigits() ?? SITE_WHATSAPP.replace(/\D/g, "");
  return chatAddress(digits, `Hi ${BRAND_NAME}, I'd like early access.`) ?? `https://wa.me/${digits}`;
}
