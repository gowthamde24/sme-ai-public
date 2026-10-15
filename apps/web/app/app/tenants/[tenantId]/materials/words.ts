import { catalogueWords } from "../catalogue/catalogue-words";
import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the building-materials product screens (job CO): everything the photo parts need (`catalogue.*`), the `mat.*` strings and the shared refusals. Resolved on the server and handed down as props. */
export function materialWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  return { ...catalogueWords(lang), ...Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("mat.") || k.startsWith("fields.form.") || k.startsWith("today.err."))) };
}
