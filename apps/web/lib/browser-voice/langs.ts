/** The languages the voice speaks, and the audio rates: the few words the page needs before any voice code. `protocol.ts` (the socket's messages and their parsers, which carry the chat cards' readers) re-exports them; Today's first chunk reads them from here. */
export const VOICE_LANGS = ["te", "en", "hi", "kn", "ta", "ml", "mr"] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];
export const isVoiceLang = (v: unknown): v is VoiceLang => (VOICE_LANGS as readonly unknown[]).includes(v);
export const IN_RATE = 16_000;
export const OUT_RATE = 24_000;
