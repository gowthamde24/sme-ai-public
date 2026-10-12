import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the "This week" page (`report.*`), in the person's language, resolved on the server. */
export function reportWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  return Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("report.")));
}
