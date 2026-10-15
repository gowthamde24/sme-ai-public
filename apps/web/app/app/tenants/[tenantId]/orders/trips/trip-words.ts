import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the deliveries screens (job CO) in the person's language: every `trip.*` string, the photo errors, the shared refusals and the few words they reuse from the quotes screens. Resolved on the server and handed down as props. */
export function tripWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) =>
    k.startsWith("trip.") || k.startsWith("today.err.") || k.startsWith("catalogue.photo.") || k.startsWith("catalogue.err.") || k.startsWith("mat.unit.") ||
    ["today.act.working", "today.act.cancel", "frame.notyet", "nav.item.orders", "mat.pdf.print", "mat.pdf.hint", "mat.pdf.to", "mat.pdf.site", "mat.q.col.item", "mat.q.col.qty", "mat.err.moduleoff"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
