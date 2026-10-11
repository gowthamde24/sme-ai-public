import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of "Contact this lead", in the person's language: the `contact.` strings and the few shared ones (a client part must not import the dictionaries). */
export function contactWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  return Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("contact.") || k.startsWith("today.lang.") || k === "today.act.working" || k === "today.act.cancel" || k === "today.err.generic"));
}
