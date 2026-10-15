import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the building-materials quote screens (job CO), in the person's language: every `mat.*` string, the shared refusals, the languages and the few words they reuse. Resolved on the server and handed down as props. */
export function quoteWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) => k.startsWith("mat.") || k.startsWith("today.err.") || k.startsWith("today.lang.") || ["today.act.working", "today.act.cancel", "frame.notyet", "nav.item.quotes", "nav.item.sites", "mat.products.add"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
