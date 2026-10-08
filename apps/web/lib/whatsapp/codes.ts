/**
 * The closed codes with which the redirect route sends a person back to the quote screen (`?whatsapp=<code>`), and the page's reading of them. A code is one of these words and nothing else: it never carries a number, a name,
 * a text from the API or anything the person typed. The page shows OUR sentence for it (`sentences.ts`); an unknown word is ignored.
 *
 *   - gate words, the database's own reading of the WhatsApp channel (the same words as the follow-up screens): consent | contact | key | erased | unkeyed
 *   - no_phone     the contact has no number
 *   - bad_number   the stored number cannot be made into a WhatsApp number by the rule in link.ts
 *   - too_long     the text does not fit in a link; the chat alone can be opened and the text pasted
 *   - not_approved the quote is not (or no longer) approved
 *   - expired      the approved quote is past its valid-until date
 *   - not_from_here the click did not come from this site's own page (the browser's Sec-Fetch-Site was missing or not same-origin/none)
 *   - unavailable  something could not be read right now
 */
export const WHATSAPP_CODES = ["consent", "contact", "key", "erased", "unkeyed", "no_phone", "bad_number", "too_long", "not_approved", "expired", "not_from_here", "unavailable"] as const;
export type WhatsappCode = (typeof WHATSAPP_CODES)[number];

/** The gate words the follow-up read can give for a channel (a closed list: anything else becomes `unavailable`). */
export const GATE_CODES = ["consent", "contact", "key", "erased", "unkeyed"] as const satisfies readonly WhatsappCode[];

export function whatsappCode(raw: string | string[] | undefined | null): WhatsappCode | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && (WHATSAPP_CODES as readonly string[]).includes(value) ? (value as WhatsappCode) : null;
}
