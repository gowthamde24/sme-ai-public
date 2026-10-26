import { cookies, headers } from "next/headers";

import type { Lang } from "@/i18n/lang";
import { LANG_COOKIE, readLang } from "@/i18n/preferences";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant/name";
import { provideRequestAssistantName } from "@/lib/assistant/request-name";
import { readAssistantName, type CtxAssistant } from "@/lib/assistant/source";
import { requireUser } from "@/lib/auth/session";
import { assistantScreens } from "@/lib/screens/flag";

/**
 * The language of the person asking, for a server component or a layout: the `sme_lang` cookie, allow-listed.
 * Outside a request (a page test calls the page function directly, with no request scope) `cookies()` throws; the answer is then English,
 * the language every existing test and the text snapshot expect. Never throws.
 *
 * It also fixes the assistant's name for this request (job DN): every page asks for the language before it draws a word, so this is where the name is known. Inside the app (an address under /app/) it is the name the owner
 * gave the assistant (Settings > AI assistant: the cookie of the test screens, or C1's API read with the person's own token for the workspace in the address), else the default; on the public site and everywhere else it is the default.
 */
export async function getLang(): Promise<Lang> {
  await primeAssistantName();
  try {
    return readLang((await cookies()).get(LANG_COOKIE)?.value);
  } catch {
    return "en";
  }
}

/** The signed-in person and the workspace of the address, for the API read of the name (only when that screen is on; a person who is not signed in gets the default and the page sends them to sign in). */
async function workspaceOf(path: string): Promise<CtxAssistant | null> {
  const tenant = /^\/app\/tenants\/([0-9a-f-]{36})(?:[/?#]|$)/.exec(path)?.[1];
  if (!tenant || assistantScreens() !== "on") return null;
  try {
    return { token: (await requireUser()).accessToken, tenantId: tenant };
  } catch {
    return null;
  }
}

/** The name is a convenience: if the address or the cookie cannot be read, the default stays and the page still draws. */
async function primeAssistantName(): Promise<void> {
  try {
    const path = (await headers()).get("x-sme-path") ?? "";
    provideRequestAssistantName(path.startsWith("/app/") ? ((await readAssistantName(await workspaceOf(path))) ?? DEFAULT_ASSISTANT_NAME) : DEFAULT_ASSISTANT_NAME);
  } catch {
    /* no request (a test calls a page directly): the default */
  }
}
