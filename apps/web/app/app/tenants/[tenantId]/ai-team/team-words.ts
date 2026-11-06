import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of My AI team v2 in the person's language (every `aiteam.*` key), handed to its client parts. Its own module, so Today's stand-up card does not pull the whole page into Today's bundle. */
export function teamWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Readonly<Record<string, string>>;
  return Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("aiteam.")));
}
