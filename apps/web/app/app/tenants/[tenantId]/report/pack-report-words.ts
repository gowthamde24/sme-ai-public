import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the pack reports (job CU): every `rep.*` string, plus the unit, status, method and age-bucket words other screens already have, which a table cell falls back on. Resolved on the server. */
export function packReportWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) => k.startsWith("rep.") || k.startsWith("mat.unit.") || k.startsWith("mat.status.") || k.startsWith("trip.status.") || k.startsWith("due.method.") || k.startsWith("edu.source.") || k.startsWith("edu.lost.");
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
