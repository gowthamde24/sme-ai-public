import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the money screens (jobs CO, CS) in the person's language: every `due.*` and `fee.*` string, the photo-free refusals and the few words they reuse. Resolved on the server and handed down as props. */
export function dueWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) =>
    k.startsWith("due.") || k.startsWith("fee.") || k.startsWith("today.err.") || k.startsWith("edu.") ||
    ["today.act.working", "today.act.cancel", "frame.notyet", "nav.item.dues", "nav.item.quotes", "mat.pdf.print", "mat.pdf.hint", "mat.s.inwords", "mat.err.moduleoff", "site.customer.unknown", "mat.products.more"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
