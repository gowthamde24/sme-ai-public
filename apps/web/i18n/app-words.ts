import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/**
 * The words one screen needs, in the person's language (job BK): every app string whose key starts with one of `prefixes`, plus the exact `extra` keys. SERVER ONLY (it reads the dictionaries): the page
 * calls it and hands the result to its parts as `words`, so a browser never receives a language it is not using nor strings it does not draw.
 */
export function wordsFor(lang: Lang, prefixes: readonly string[], extra: readonly string[] = []): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const wanted = new Set(extra);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => wanted.has(k) || prefixes.some((p) => k.startsWith(p))));
}
