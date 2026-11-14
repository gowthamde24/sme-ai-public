import type { Address, Field, Speed, Style, TalkLang, TalkOptions, TalkPrefs, TalkVoice, WordsChoice } from "./types";
import { ADDRESSES, DEFAULTS, SPEEDS, STYLES, WORDS, addressFor } from "./types";

/**
 * The test version of "How it talks to you" (OWNER_TALK_PREFS=mock): a small catalogue of made-up voice ids (three sounds, two genders, per language) and the person's choices in ONE cookie of this browser.
 * No sound is made and none is claimed: the preview of a mock answer is only the words of the sample. Pure (the cookie is read and written by source.ts).
 */
const SOUNDS = ["warm", "calm", "bright"] as const;
const NAMES: Record<string, string> = { warm: "Warm", calm: "Calm", bright: "Bright" };

export function mockVoices(language: TalkLang): TalkVoice[] {
  return (["female", "male"] as const).flatMap((gender) => SOUNDS.map((sound): TalkVoice => ({ id: `${language}-mock-${gender === "female" ? "f" : "m"}-${sound}`, name: NAMES[sound], sound, gender, sample: true })));
}

export type MockChoices = { voices: Partial<Record<TalkLang, string>>; style: Style; address: Address; words: WordsChoice; speed: Speed };
export const MOCK_START: MockChoices = { voices: {}, ...DEFAULTS };

export function mockOptions(language: TalkLang): TalkOptions {
  return { voices: mockVoices(language), style: [...STYLES], address: addressFor(language, ADDRESSES), words: [...WORDS], speed: [...SPEEDS] };
}

export function mockPrefs(language: TalkLang, c: MockChoices, undoToken: string | null = null, changed: Field[] = []): TalkPrefs {
  const options = mockOptions(language);
  const voice = options.voices.find((v) => v.id === c.voices[language]) ?? options.voices.find((v) => v.gender === "female" && v.sound === "calm") ?? null;
  const address = options.address.includes(c.address) ? c.address : DEFAULTS.address;
  return { language, voice, style: c.style, address, words: c.words, speed: c.speed, isDefault: c.style === DEFAULTS.style && address === DEFAULTS.address && c.words === DEFAULTS.words && c.speed === DEFAULTS.speed && c.voices[language] === undefined, options, undoToken, changed };
}

const SAMPLE: Record<TalkLang, Record<Style, string>> = {
  en: { friendly: "Hi! Three new enquiries came in. Want me to call them?", respectful: "Good morning. Three new enquiries have come in. Shall I call them?", very_formal: "Good morning. Three new enquiries have been received. May I place the calls on your behalf?", short_direct: "Three new enquiries. Call them?" },
  te: { friendly: "హాయ్! మూడు కొత్త enquiries వచ్చాయి. కాల్ చెయ్యనా?", respectful: "నమస్కారం. మూడు కొత్త enquiries వచ్చాయండి. కాల్ చెయ్యమంటారా?", very_formal: "నమస్కారం. మూడు కొత్త విచారణలు వచ్చాయి. మీ అనుమతితో వారికి కాల్ చేయవచ్చునా?", short_direct: "మూడు కొత్త enquiries. కాల్ చెయ్యనా?" },
  kn: { friendly: "ಹಾಯ್! ಮೂರು ಹೊಸ enquiries ಬಂದಿವೆ. ಕಾಲ್ ಮಾಡಲಾ?", respectful: "ನಮಸ್ಕಾರ. ಮೂರು ಹೊಸ enquiries ಬಂದಿವೆ. ಕಾಲ್ ಮಾಡಬೇಕಾ?", very_formal: "ನಮಸ್ಕಾರ. ಮೂರು ಹೊಸ ವಿಚಾರಣೆಗಳು ಬಂದಿವೆ. ನಿಮ್ಮ ಅನುಮತಿಯೊಂದಿಗೆ ಕರೆ ಮಾಡಬಹುದೇ?", short_direct: "ಮೂರು ಹೊಸ enquiries. ಕಾಲ್ ಮಾಡಲಾ?" },
  hi: { friendly: "हाय! तीन नई enquiries आई हैं। कॉल करूँ?", respectful: "नमस्ते। तीन नई enquiries आई हैं। कॉल कर दूँ?", very_formal: "नमस्कार। तीन नई पूछताछ प्राप्त हुई हैं। क्या मैं आपकी अनुमति से उन्हें कॉल कर सकता हूँ?", short_direct: "तीन नई enquiries। कॉल करूँ?" },
};
/** The words of the sample (mock only): the style decides the sentence; the others do not change a fixed sentence. */
export const mockSample = (language: TalkLang, style: Style): string => SAMPLE[language][style];
