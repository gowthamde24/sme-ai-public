/**
 * The assistant's name: the ONE place that says what it is called when nobody has chosen (job DN). Every user-visible mention of the assistant is the placeholder `{assistant}` in a string (never a name written in a
 * sentence, a component or a test): `fill()` and the dictionaries of i18n/ put the name in when the words are drawn. A workspace's own name (Settings > AI assistant) comes from `provider`, which the server sets for each
 * request (lib/assistant/request-name.ts); with no request (a browser, a test, the public site) the name is the default. Client safe: plain constants and functions, no server import.
 */
/**
 * No fixed name (owner, 28 Oct): until the owner names the assistant it is the plain phrase below (said in the reader's language by lib/assistant/default-name.ts, which only the server's dictionaries use). A name the owner set is a proper name and is used as written.
 */
export const DEFAULT_ASSISTANT_NAME = "your assistant";
export const ASSISTANT_PLACEHOLDER = "{assistant}";

let provider: () => string = () => DEFAULT_ASSISTANT_NAME;
/** The server says where the name of the request being drawn is kept (request-name.ts). */
export function setAssistantNameProvider(next: () => string): void {
  provider = next;
}
/** The name for the request being drawn: the workspace's own, or the default. */
export const currentAssistantName = (): string => provider();

/**
 * A text with `{assistant}` replaced by the name (the current one unless given). A text without the placeholder is returned as it is. The default name is capitalised when it opens the text ("Your assistant this week"); a name the owner set is used as written.
 * (The server's dictionaries do the full job, per language and after any sentence end: lib/assistant/default-name.ts.)
 */
export function withAssistantName(text: string, name: string = currentAssistantName()): string {
  return text.includes(ASSISTANT_PLACEHOLDER) ? text.replace(/\{assistant\}/g, (_m, at: number) => (at === 0 && name === DEFAULT_ASSISTANT_NAME ? "Your assistant" : name)) : text;
}
