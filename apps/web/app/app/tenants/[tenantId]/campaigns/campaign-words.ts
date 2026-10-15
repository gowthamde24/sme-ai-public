import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the campaign and call-list screens (job CQ) in the person's language: every `camp.*` string, the refusals and the few words they reuse. Resolved on the server and handed down as props. */
export function campaignWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) =>
    k.startsWith("camp.") || k.startsWith("today.err.") || k.startsWith("today.lang.") ||
    ["today.act.working", "today.act.cancel", "due.err.amount", "mat.products.more", "mat.err.moduleoff", "nav.item.campaigns", "nav.item.calllist", "frame.notyet"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
