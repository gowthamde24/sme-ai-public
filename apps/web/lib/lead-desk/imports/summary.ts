import { formatRupeesShort } from "@/lib/money";

import type { Counts, Estimate } from "./types";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The counts of a preview or an import in plain words, in one line: "412 ready · 23 duplicates merged · 9 invalid · 31 on the Do-Not-Disturb list (WhatsApp only)". A count of zero is left out (except "ready"). `duplicates
 * merged` adds the rows merged into a lead you already have and the repeats inside the file. Pure: the sentences come from the page's words.
 */
export function countsLine(c: Counts, t: Say): string {
  const dups = c.duplicates_merged + c.duplicates_in_file;
  const parts = [
    t("li.pv.ready", { n: c.ready }),
    dups > 0 ? t("li.pv.dups", { n: dups }) : null,
    c.already_imported > 0 ? t("li.pv.seen", { n: c.already_imported }) : null,
    c.invalid > 0 ? t("li.pv.invalid", { n: c.invalid }) : null,
    c.dnd > 0 ? t("li.pv.dnd", { n: c.dnd }) : null,
    c.no_consent > 0 ? t("li.pv.noconsent", { n: c.no_consent }) : null,
    c.blocked > 0 ? t("li.pv.blocked", { n: c.blocked }) : null,
  ];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

/** "About 240 minutes of calls, 96 messages, ₹12" or null when there is nothing to estimate (nobody to call or write to). The money is the number the API gave, written down (the model never calculates it). */
export function estimateLine(e: Estimate, t: Say): string | null {
  if (e.messages === 0 && e.call_minutes === 0) return null;
  return t("li.pv.estimate", { minutes: e.call_minutes, messages: e.messages, cost: e.cost_paise === null ? "—" : formatRupeesShort(e.cost_paise) });
}
