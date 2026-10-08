import type { WhatsappCode } from "./codes";

/**
 * What the quote screen says for each closed code of the WhatsApp redirect (lib/whatsapp/codes.ts). Our wording only: the words of the follow-up screens where a gate word is the same, English only. No sentence has a
 * place for a number, a name or a text: a sentence is fixed.
 */
export const WHATSAPP_SENTENCES: Record<WhatsappCode, string> = {
  consent: "There is no recorded WhatsApp consent for this person, or they have no number saved. Record consent first, or check their details.",
  contact: "This person has asked not to be contacted, so WhatsApp is not offered.",
  key: "This phone number is on the do-not-contact list, so WhatsApp is not offered.",
  erased: "This person's details were erased, so WhatsApp is not offered.",
  unkeyed: "This person's number has no suppression key yet, so WhatsApp is not offered. The owner records keys on the Suppression keys page.",
  no_phone: "This person has no phone number saved, so WhatsApp cannot be opened. You can still copy the text.",
  bad_number: "The saved number cannot be used for a WhatsApp link. Check it on the contact. You can still copy the text.",
  too_long: "This quote is too long to put in a link. Press Copy text, open the chat, and paste it.",
  not_approved: "This quote is not approved (any more), so WhatsApp is not offered.",
  expired: "This quote has expired, so WhatsApp is not offered. You can still copy the text.",
  not_from_here: "WhatsApp was not opened, because the click did not come from this page. Press the button on this page again, or press Copy text.",
  unavailable: "WhatsApp could not be prepared right now. Try again shortly, or press Copy text.",
};

export const NO_POLICY_NOTE = "No follow-up policy is in force. Recording that you sent this works, but the lead will not appear on the follow-up list until the owner publishes a policy.";
export const NOTHING_SENT = "Opens your WhatsApp with this text ready. You press send yourself. Nothing is sent by this system.";
export const SENT_AGAIN = "Recording this again for a revised quote counts as another message sent to this lead.";
