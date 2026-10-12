/**
 * "Send this by WhatsApp" for a text with NO recipient (job CC, the team's invitation): WhatsApp's own share address, which opens the app's chooser so the person picks who gets it. It holds no phone number and does no
 * number logic: the number rule (a customer's chat) is lib/whatsapp/link.ts and nothing else makes a wa.me address with a number in it. The text goes in the address, so it is only ever text the person is about to send by hand.
 */
export const WHATSAPP_SHARE = "https://wa.me/?text=";

export function whatsappShareLink(text: string): string {
  return `${WHATSAPP_SHARE}${encodeURIComponent(text.slice(0, 1500))}`;
}
