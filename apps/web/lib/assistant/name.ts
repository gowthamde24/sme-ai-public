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
 * A text with `{assistant}` replaced by the name (the current one unless given). A text without the placeholder is returned as it is. Client safe and small (the route-JS budget counts it on every page): the server's dictionaries say the default name in the reader's language and
 * capitalised at a sentence start (lib/assistant/default-name.ts), so the words a screen receives are already right; this is only for a fallback English word.
 */
export function withAssistantName(text: string, name: string = currentAssistantName()): string {
  return text.includes(ASSISTANT_PLACEHOLDER) ? text.replaceAll(ASSISTANT_PLACEHOLDER, () => name) : text;
}
