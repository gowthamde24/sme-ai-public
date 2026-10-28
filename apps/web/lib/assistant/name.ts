/**
 * The assistant's name: the ONE place that says what it is called when nobody has chosen (job DN). Every user-visible mention of the assistant is the placeholder `{assistant}` in a string (never a name written in a
 * sentence, a component or a test): `fill()` and the dictionaries of i18n/ put the name in when the words are drawn. A workspace's own name (Settings > AI assistant) comes from `provider`, which the server sets for each
 * request (lib/assistant/request-name.ts); with no request (a browser, a test, the public site) the name is the default. Client safe: plain constants and functions, no server import.
 */
/**
 * No fixed name (owner, 28 Oct): until the owner names the assistant it is the plain phrase below, in the reader's language (DEFAULT_NAME_BY_LANG; the Hindi word is the feminine "असिस्टेंट" the verbs of these strings were written for).
 * At the start of an English sentence it is capitalised. A name the owner set is a proper name and is used as written.
 */
export const DEFAULT_ASSISTANT_NAME = "your assistant";
export const DEFAULT_NAME_BY_LANG: Readonly<Record<string, string>> = { en: DEFAULT_ASSISTANT_NAME, te: "మీ అసిస్టెంట్", hi: "आपकी असिस्टेंट", kn: "ನಿಮ್ಮ ಅಸಿಸ್ಟೆಂಟ್" };
export const ASSISTANT_PLACEHOLDER = "{assistant}";

let provider: () => string = () => DEFAULT_ASSISTANT_NAME;
/** The server says where the name of the request being drawn is kept (request-name.ts). */
export function setAssistantNameProvider(next: () => string): void {
  provider = next;
}
/** The name for the request being drawn: the workspace's own, or the default. */
export const currentAssistantName = (): string => provider();

/** A text with `{assistant}` replaced by the name (the current one unless given). A text without the placeholder is returned as it is. */
export function withAssistantName(text: string, name: string = currentAssistantName(), lang = "en"): string {
  if (!text.includes(ASSISTANT_PLACEHOLDER)) return text;
  const isDefault = name === DEFAULT_ASSISTANT_NAME;
  const shown = isDefault ? (DEFAULT_NAME_BY_LANG[lang] ?? name) : name;
  const startsSentence = (at: number): boolean => at === 0 || /([.!?]\s+|["“(])$/.test(text.slice(0, at));
  return text.replace(/\{assistant\}/g, (_m, at: number) => (isDefault && lang === "en" && startsSentence(at) ? `${shown[0].toUpperCase()}${shown.slice(1)}` : shown));
}
