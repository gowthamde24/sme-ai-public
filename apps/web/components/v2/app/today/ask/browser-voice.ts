import type { VoiceLang } from "@/lib/browser-voice/protocol";

import type { Words } from "../../words";
import type { WorkOptions } from "./work";

/** What the floating orb needs to open "Talk to your assistant" (job DV): the words, the socket's address, the language in use and the address that hands over the person's sign-in for the socket's first message. */
export type BrowserVoice = {
  words: Words;
  url: string;
  language: VoiceLang;
  languageNames: Record<VoiceLang, string>;
  /** The route that hands over the person's sign-in for the socket's first message (a plain POST, not a server action: that would make Next draw the page again under the open chat). */
  tokenUrl: string;
  /** Typing by voice (app v4): where a field's recording is posted (`<workspace>/speech-transcribe`); absent = no microphone on text fields. */
  speechUrl?: string;
  /** "Mispronounced?" on spoken messages (Owner and Admin, PRONUNCIATION_SCREENS on): the words are taught through `<base>/pronunciation`. */
  pronunciation?: boolean;
  /** The language the person chose for this chat on the pill ("auto" or a language), from their member profile; null/absent = never chosen (the app's language) or this API does not keep it yet. */
  chatLanguage?: string | null;
  /** Where the pill saves the choice (`<base>/chat-language`); absent = only this browser remembers. */
  chatLanguageUrl?: string;
  /** The assistant does the work (ASSISTANT_WORK_SCREENS): files in the chat and the work cards. Absent = the chat as before. */
  work?: WorkOptions;
  /**
   * Plan tiers (owner decision 4 Nov; C1's #317). `on`: the plan (Lead Desk) has no Lead Finder, so a Lead Finder card in the chat is drawn as the upgrade card ("Finding new customers is part of AI Workforce") instead, with no OK
   * (nothing is searched). The API's own answer on Lead Desk is a `cant_do` work card with reason `not_in_plan`: that card is the work cards' (#302), not this. `planHref`: the plans page (or Settings -> Plan) for the Owner and Admin, null
   * for anyone else (the card says who can change the plan). Absent = `on` false, no link.
   */
  finderUpsell?: { on: boolean; planHref: string | null };
};
