import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/**
 * The words of the catalogue's client parts, in the person's language (a client component must not import the dictionaries: all four would land in the browser bundle): every `catalogue.*` string, the
 * shared refusals and languages of Today, the words the send panel reuses from "Contact this lead", and the menu words. Resolved on the server and handed down as props.
 */
export function catalogueWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) =>
    k.startsWith("catalogue.") || k.startsWith("today.err.") || k.startsWith("today.lang.") || k.startsWith("contact.state.") || k.startsWith("contact.record.") ||
    ["today.act.working", "today.act.cancel", "frame.notyet", "nav.item.sarees", "nav.item.outbox", "contact.keep", "contact.keep.help", "contact.language"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
