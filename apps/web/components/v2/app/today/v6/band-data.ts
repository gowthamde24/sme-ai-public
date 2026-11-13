import { formatRupeesShort } from "@/lib/money";

import type { NeedsCard } from "../types";

/**
 * Today's dark band, the data (design system v6, the final Today). Pure: no fetch, no React. Everything here is built from what Today already reads (the cards that wait, the store's visits, the new leads count); a number that cannot be read is null and the band leaves that piece out, never a made-up figure.
 */

/** The pieces of the briefing's first sentence: enquiries and visits booked. A piece that is null is not said. */
export type BandFacts = { enquiries: number | null; visits: number | null };
export type LinePiece = { key: "enq" | "visits"; n: number };

export function linePieces(f: BandFacts): LinePiece[] {
  const out: LinePiece[] = [];
  if (f.enquiries !== null && f.enquiries >= 0) out.push({ key: "enq", n: f.enquiries });
  if (f.visits !== null && f.visits >= 0) out.push({ key: "visits", n: f.visits });
  return out;
}

/** The decision at the top of the person's list, for the briefing's link: a quote waiting for the OK (its amount and the customer, opening the quote) is the one the briefing names. null = no quote with an amount waits. */
export type TopDecision = { amountText: string; name: string; href: string };
export function topDecision(needs: readonly NeedsCard[] | null): TopDecision | null {
  for (const c of needs ?? []) {
    if (c.type !== "item") continue;
    if ((c.item.kind === "quote_approval" || c.item.kind === "material_quote_approval") && typeof c.item.amount_paise === "number" && c.item.amount_paise > 0) {
      return { amountText: formatRupeesShort(c.item.amount_paise), name: c.item.customer, href: c.item.href };
    }
  }
  return null;
}

/** The example instructions the composer cycles through as its ghost text (real things the assistant does). */
export const PLACEHOLDER_KEYS = ["tv6.ph.1", "tv6.ph.2", "tv6.ph.3", "tv6.ph.4"] as const;
/** The three chips: each prefills the input with the start of an instruction. */
export const CHIPS = [
  { id: "call", label: "tv6.chip.call", fill: "tv6.chip.call.fill" },
  { id: "whatsapp", label: "tv6.chip.wa", fill: "tv6.chip.wa.fill" },
  { id: "quote", label: "tv6.chip.quote", fill: "tv6.chip.quote.fill" },
] as const;

/**
 * The ghost completion of what is typed: the rest of the first example that begins with it (not case-sensitive, at least two letters typed). Tab accepts it. Empty text has no ghost here (the cycling example is drawn instead). null = nothing to offer.
 */
export function ghostOf(text: string, examples: readonly string[]): string | null {
  const typed = text.trimStart();
  if (typed.trim().length < 2) return null;
  const low = typed.toLowerCase();
  const hit = examples.find((e) => e.length > typed.length && e.toLowerCase().startsWith(low));
  return hit ? hit.slice(typed.length) : null;
}
