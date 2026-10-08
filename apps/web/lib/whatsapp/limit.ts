/**
 * How long the quote text may be inside a WhatsApp link. This file holds NO phone number and no number logic, so a page may import it to decide, before any click, which control to show.
 *
 * `MAX_LINK_TEXT_ENCODED` is a PLACEHOLDER chosen by us. It is NOT a WhatsApp fact: WhatsApp's real limit on the length of the `text` parameter, and any limit a browser, Node or a proxy puts on a redirect's `Location`
 * header, are UNVERIFIED (docs/plans/open-in-whatsapp-plan.md, sections 3 and 7). The owner replaces the value after trying a long link by hand on their own phone. The length counted is the length of the ENCODED
 * text (the rupee sign is nine characters, a line break is three).
 *
 * A quote is never shortened to fit. Over the limit the text does not go into the link at all: the person copies it and pastes it into the chat.
 */
export const MAX_LINK_TEXT_ENCODED = 2000;

/** The length of the text as it would sit in the link (percent-encoded). */
export function encodedLength(text: string): number {
  return encodeURIComponent(text).length;
}

/** True when the whole text fits in the link at the limit above. An empty text does not: there is nothing to send. */
export function fitsInLink(text: string): boolean {
  return text.length > 0 && encodedLength(text) <= MAX_LINK_TEXT_ENCODED;
}
