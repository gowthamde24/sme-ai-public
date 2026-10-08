import { MAX_LINK_TEXT_ENCODED, encodedLength } from "./limit";

/**
 * The WhatsApp number rule and the `wa.me` address. SERVER ONLY, and only the redirect route under app/app/tenants/[tenantId]/quotes/[quoteId]/whatsapp/ may import this file (test/whatsapp-guard.test.ts): this is the
 * one place in the web app that turns a stored phone number into something that leaves the server, and it does so only inside a redirect response to one click (docs/plans/open-in-whatsapp-plan.md, section 2).
 *
 * The stored number is whatever the person typed. WhatsApp needs digits with the country code. The rule is the owner's (decision 2 of the plan), and it never guesses:
 *   - a number written with a leading `+`, or with `00`, keeps the country code it was written with;
 *   - a number with no country code is accepted ONLY as a plain ten-digit Indian mobile starting 6 to 9 (then 91 is put in front);
 *   - anything else is not a usable number (`null`): 12 digits starting 91 with no plus, a leading 0, nine or eleven digits, letters, a plus in the middle, and the synthetic `+00` numbers of this workspace.
 * Spaces, hyphens, dots and brackets are separators and are ignored. Only ASCII digits count after Unicode compatibility normalisation (full-width digits become ASCII; Arabic-Indic digits stay what they are and are refused).
 *
 * Nothing here throws with, returns, or logs the number it was given: a refusal is `null`.
 */
const SEPARATORS = /[\s().-]/g;
const ONLY_DIGITS = /^[0-9]+$/;
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/;
const DIGITS_FOR_LINK = /^[1-9][0-9]{7,14}$/; // E.164: a country code never starts with 0; at most 15 digits; fewer than 8 is not a number

/** The digits to put after `https://wa.me/`, or null when the stored number cannot be turned into a WhatsApp number by the rule above. */
export function whatsappDigits(stored: string | null | undefined): string | null {
  if (typeof stored !== "string") return null;
  const text = stored.normalize("NFKC").trim();
  if (text === "") return null;
  const plus = text.startsWith("+");
  const body = (plus ? text.slice(1) : text).replace(SEPARATORS, "");
  if (!ONLY_DIGITS.test(body)) return null;
  let international: string | null = null;
  if (plus) international = body;
  else if (body.startsWith("00")) international = body.slice(2);
  if (international !== null) return DIGITS_FOR_LINK.test(international) ? international : null;
  return INDIAN_MOBILE.test(body) ? `91${body}` : null;
}

/**
 * `https://wa.me/<digits>` with the text prefilled, or the chat alone when `text` is null. The text is percent-encoded whole and never shortened: a text longer than the limit is refused (null), and the caller
 * opens the chat alone instead. `digits` must come from `whatsappDigits`.
 */
export function whatsappUrl(digits: string, text: string | null): string | null {
  if (!DIGITS_FOR_LINK.test(digits)) return null;
  if (text === null) return `https://wa.me/${digits}`;
  if (text.length === 0 || encodedLength(text) > MAX_LINK_TEXT_ENCODED) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
