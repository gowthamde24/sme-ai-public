import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the sites screens (job CO) in the person's language: every `site.*` string, the shared refusals and the few words of Today and the menu they reuse. */
export function siteWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) => k.startsWith("site.") || k.startsWith("today.err.") || ["today.act.working", "today.act.cancel", "frame.notyet", "nav.item.sites", "mat.products.more"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
