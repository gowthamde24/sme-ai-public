import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/**
 * The words of the setup wizard and checklist (job BJ), in the person's language: every `setup.*` string, and the few existing ones the wizard reuses (the catalogue's fabrics, colours, zari, photo and refusal
 * sentences, the opening-hours words, the automatic-sending sentence, Today's refusals). Resolved on the server and handed to the client parts as props (a client component must not import the dictionaries).
 */
export function setupWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) =>
    k.startsWith("setup.") || k.startsWith("catalogue.field.") || k.startsWith("catalogue.fabric.") || k.startsWith("catalogue.colour.") || k.startsWith("catalogue.zari.") || k.startsWith("catalogue.photo.") ||
    k.startsWith("catalogue.err.") || k.startsWith("today.err.") || ["catalogue.form.band.help", "visits.hours.order", "visits.hours.save", "agentset.sending.on"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
