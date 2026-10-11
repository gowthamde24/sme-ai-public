import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/**
 * The words of the Outbox page's client parts, in the person's language (a client component must not import the dictionaries): every `outbox.*` string, the languages' names, and the few words of Today's
 * decisions the rows reuse (approve, edit, not now, the refusals).
 */
export function outboxWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) => k.startsWith("outbox.") || k.startsWith("today.lang.") || k.startsWith("today.err.") || ["today.act.approve", "today.act.edit", "today.act.notnow", "today.act.save", "today.act.cancel", "today.act.working", "today.edit.label", "today.edit.hint", "today.customer.unknown", "frame.notyet", "nav.item.outbox"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
