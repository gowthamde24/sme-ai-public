import { reviewedOnly } from "@/i18n/strings";

import { reviewedPackLabels } from "./reviewed-labels";

import type { WorkspacePack } from "./types";

/**
 * A business's own word for a visit (the pack's `word.visit` / `word.visits`: Site visit, Campus visit, Test drive, Appointment ...; C1 #308) on the screens that said "store": the Today card's title
 * ("{visits} today" instead of "At the store today") and the call request's button ("{visit}" on the row, "{visit} instead" on the card). Only where the pack has the word IN THIS LANGUAGE (an English word
 * never lands in a Telugu screen), and not for a pack whose word is the plain "Visit" (a shop: its "store" words stay). Nothing here names a business type.
 */
export function withVisitWords<F extends (key: never, vars?: never) => string>(t: F, pack: Pick<WorkspacePack, "labels"> | null, lang: string): F {
  const en = pack?.labels.en?.["word.visit"];
  // (reviewed-only mode: only the pack words the owner approved, i18n/review/pack-labels-reviewed.json)
  const word = (key: string): string | undefined => (lang !== "en" && reviewedOnly() ? (pack?.labels[lang]?.[key] !== undefined ? reviewedPackLabels(lang)[key] : undefined) : pack?.labels[lang]?.[key]);
  const visit = word("word.visit");
  if (!pack || !en || en.trim().toLowerCase() === "visit" || !visit) return t;
  const visits = word("word.visits") ?? visit;
  const tt = t as unknown as (key: string, vars?: Record<string, string>) => string;
  const own: Record<string, () => string> = {
    "today.visits.title": () => tt("today.visits.title.pack", { visits }),
    "today.act.visit.row": () => visit,
    "today.act.visit": () => tt("today.act.visit.pack", { visit }),
  };
  return ((key: never, vars?: never) => (typeof key === "string" && key in own ? own[key]() : t(key, vars))) as unknown as F;
}
