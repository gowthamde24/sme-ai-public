import { cookies } from "next/headers";

import type { Lang } from "@/i18n/lang";
import { LANG_COOKIE, readLang } from "@/i18n/preferences";

/**
 * The language of the person asking, for a server component or a layout: the `sme_lang` cookie, allow-listed.
 * Outside a request (a page test calls the page function directly, with no request scope) `cookies()` throws; the answer is then English,
 * the language every existing test and the text snapshot expect. Never throws.
 */
export async function getLang(): Promise<Lang> {
  try {
    return readLang((await cookies()).get(LANG_COOKIE)?.value);
  } catch {
    return "en";
  }
}
