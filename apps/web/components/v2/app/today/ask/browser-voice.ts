import type { VoiceLang } from "@/lib/browser-voice/protocol";

import type { Words } from "../../words";

/** What the floating orb needs to open "Talk to your assistant" (job DV): the words, the socket's address, the language in use and the address that hands over the person's sign-in for the socket's first message. */
export type BrowserVoice = {
  words: Words;
  url: string;
  language: VoiceLang;
  languageNames: Record<VoiceLang, string>;
  /** The route that hands over the person's sign-in for the socket's first message (a plain POST, not a server action: that would make Next draw the page again under the open chat). */
  tokenUrl: string;
  /** "Mispronounced?" on spoken messages (Owner and Admin, PRONUNCIATION_SCREENS on): the words are taught through `<base>/pronunciation`. */
  pronunciation?: boolean;
  /** The language the person chose for this chat on the pill ("auto" or a language), from their member profile; null/absent = never chosen (the app's language) or this API does not keep it yet. */
  chatLanguage?: string | null;
  /** Where the pill saves the choice (`<base>/chat-language`); absent = only this browser remembers. */
  chatLanguageUrl?: string;
};
