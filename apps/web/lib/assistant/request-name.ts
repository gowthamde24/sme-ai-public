import { cache } from "react";

import { DEFAULT_ASSISTANT_NAME, setAssistantNameProvider } from "./name";

/**
 * The assistant's name for ONE request (job DN), SERVER ONLY. React's `cache` gives each request its own slot, so two people (or two workspaces) never see each other's name; outside a request (a test calls a page directly)
 * it is simply the default. `primeAssistantName` is called by `getLang()` (every page and layout asks for the language first, before it draws a word), which looks at the address and, inside a workspace, at the name its owner
 * chose; the dictionaries and `fill()` then read it through `currentAssistantName()`. Layouts and pages of one request run side by side, so each of them primes the same value.
 */
const slot = cache((): { name: string } => ({ name: DEFAULT_ASSISTANT_NAME }));
setAssistantNameProvider(() => slot().name);

export function provideRequestAssistantName(name: string): void {
  slot().name = name;
}
