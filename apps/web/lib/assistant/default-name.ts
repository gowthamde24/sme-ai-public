import { ASSISTANT_PLACEHOLDER, DEFAULT_ASSISTANT_NAME } from "./name";

/**
 * The default assistant name in the reader's language, and the lang-aware fill of `{assistant}` (SERVER dictionaries only: kept out of lib/assistant/name.ts so the route-JS budget does not count the Telugu, Hindi and Kannada words in every page).
 * The Hindi word is the feminine "असिस्टेंट" the verbs of these strings were written for. At the start of an English sentence the default is capitalised; a name the owner set is used as written.
 */
export const DEFAULT_NAME_BY_LANG: Readonly<Record<string, string>> = { en: DEFAULT_ASSISTANT_NAME, te: "మీ అసిస్టెంట్", hi: "आपकी असिस्टेंट", kn: "ನಿಮ್ಮ ಅಸಿಸ್ಟೆಂಟ್" };

export function withNamedAssistant(text: string, name: string, lang: string): string {
  if (!text.includes(ASSISTANT_PLACEHOLDER)) return text;
  const isDefault = name === DEFAULT_ASSISTANT_NAME;
  const shown = isDefault ? (DEFAULT_NAME_BY_LANG[lang] ?? name) : name;
  const startsSentence = (at: number): boolean => at === 0 || /([.!?]\s+|["“(])$/.test(text.slice(0, at));
  return text.replace(/\{assistant\}/g, (_m, at: number) => (isDefault && lang === "en" && startsSentence(at) ? `${shown[0].toUpperCase()}${shown.slice(1)}` : shown));
}
