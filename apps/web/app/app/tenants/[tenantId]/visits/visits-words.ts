import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/**
 * The words of the Visits page's client parts, in the person's language (a client component must not import the dictionaries: all four would land in the browser bundle): every `visits.*` string, the
 * shared refusals and buttons of Today, and the menu word. Resolved on the server and handed down as props.
 */
export function visitsWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) => k.startsWith("visits.") || k.startsWith("today.err.") || k === "today.act.working" || k === "today.act.cancel" || k === "frame.notyet" || k === "nav.item.visits";
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
