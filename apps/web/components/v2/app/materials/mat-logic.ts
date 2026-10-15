import type { MaterialItemOut, MaterialItemSummaryOut } from "@contracts";

import { say, type TodayWords } from "../today/today-words";

/**
 * Small pure helpers of the building-materials screens (job CO): the words of a closed unit, what a product still needs before it can be quoted, and the cards' badges. Nothing here prices anything.
 */
export const unitWord = (words: TodayWords, unit: string): string => say(words, `mat.unit.${unit}`);
/** "per sq ft": the unit a price is quoted in. */
export const perUnit = (words: TodayWords, unit: string): string => say(words, "mat.per", { unit: unitWord(words, unit) });

/** What the API says is missing, in a fixed order, as codes our words know (`mat.missing.<code>`); an unknown code is kept as "other" so a newer API never draws a raw key. */
const KNOWN = ["price", "gst_rate", "pieces_per_area", "area_unit"] as const;
export function missingFor(inputs: MaterialItemOut["inputs"], byArea: boolean): string[] {
  const codes = byArea ? inputs.missing_for_area : inputs.missing_for_quantity;
  return [...new Set(codes.map((c) => ((KNOWN as readonly string[]).includes(c) ? c : "other")))];
}

/** The product can be quoted when the API names nothing missing for the way it is sold (by area, or by quantity). */
export function quotable(item: Pick<MaterialItemOut, "area_unit" | "inputs">): boolean {
  return missingFor(item.inputs, item.area_unit !== null).length === 0;
}

export type Badge = "inactive" | "few_left" | "made_to_order";
export function badgesOf(i: Pick<MaterialItemSummaryOut, "active" | "stock_status">): Badge[] {
  const out: Badge[] = [];
  if (!i.active) out.push("inactive");
  if (i.stock_status === "few_left" || i.stock_status === "made_to_order") out.push(i.stock_status);
  return out;
}

export function soonest(items: readonly Pick<MaterialItemSummaryOut, "cover">[]): number | null {
  const secs = items.map((i) => i.cover?.expires_in_seconds).filter((s): s is number => typeof s === "number" && s > 0);
  return secs.length ? Math.min(...secs) : null;
}
