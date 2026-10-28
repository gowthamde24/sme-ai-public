import type { VoiceLang } from "@/lib/browser-voice/protocol";

import type { Words } from "../../words";

/** What the floating orb needs to open "Talk to your assistant" (job DV): the words, the socket's address, the language in use and the server action that hands over the person's sign-in for the socket's first message. */
export type BrowserVoice = {
  words: Words;
  url: string;
  language: VoiceLang;
  languageNames: Record<VoiceLang, string>;
  getToken: () => Promise<{ ok: true; token: string } | { ok: false }>;
};
