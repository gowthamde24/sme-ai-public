/**
 * Pure logic of the "Quote with typed prices" form (no server, no React). A person types a price in RUPEES; it is turned into integer PAISE by reading the text (two digits move
 * across the point), never with floating point. More than two digits after the point, a sign, an exponent, a comma, a letter or an empty field is refused with a sentence BEFORE any
 * request is made. Every rule here is GUIDANCE for the screen: the API and the database check every limit again, and they alone work out GST and totals.
 */
import { PRICE_LIMITS, priceOutsideRange, type ItemType } from "@/lib/api/item-types";
import type { ManualLineInput } from "@/lib/api/quotes";

import { rupeesToPaise } from "../quote-policy/quote-policy-logic";

export const MAX_LINES = 5;
export const MAX_QUANTITY = 10_000;
const ITEM_TYPE_CODE = /^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$/;
const QUANTITY = /^[0-9]{1,5}$/;

/** What a person typed for one line (text, exactly as typed). */
export interface LineValues {
  code: string;
  qty: string;
  price: string;
}
export const EMPTY_LINE: LineValues = { code: "", qty: "", price: "" };

/** Rupees typed as text -> integer paise from 1 to the API's largest price, or null. "0", "1.505", "-1", "abc", "1,000" and "" are all null. */
export function priceToPaise(text: string): number | null {
  const paise = rupeesToPaise(text, PRICE_LIMITS.maxPaise);
  return paise !== null && paise >= PRICE_LIMITS.minPaise ? paise : null;
}

/** A whole number of pieces from 1 to 10,000 (digits only), or null. */
export function quantityOf(text: string): number | null {
  const t = text.trim();
  if (!QUANTITY.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

/** OUR sentence for each thing that can be wrong on a line. No number the person typed is repeated. */
export const LINE_TEXT = {
  itemType: "Choose an item type.",
  qty: "Quantity: enter a whole number of pieces from 1 to 10,000, using digits only.",
  price: "Price per piece: enter rupees with at most two digits after the point, for example 2500 or 2499.50. It must be more than 0 and at most 10,00,000.",
} as const;
export const NEED_A_LINE = "Add at least one line.";
export const TOO_MANY_LINES = "A quote has at most 5 lines.";
export const CHOOSE_KIND = "Say whether this is a new or a repeat customer.";
export const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";
export const RANGE_NOTE = "This price is outside the usual range for this item type. You can still save it; the owner will see a flag.";

export type LinesResult = { ok: true; lines: ManualLineInput[] } | { ok: false; error: string; line?: number };

/** The typed lines as the request's lines, or the first problem with its sentence (and the line it is on, counted from 1). Nothing is guessed or defaulted. */
export function linesFromForm(values: LineValues[]): LinesResult {
  if (values.length < 1) return { ok: false, error: NEED_A_LINE };
  if (values.length > MAX_LINES) return { ok: false, error: TOO_MANY_LINES };
  const lines: ManualLineInput[] = [];
  for (const [index, value] of values.entries()) {
    const line = index + 1;
    const code = value.code.trim();
    if (!ITEM_TYPE_CODE.test(code)) return { ok: false, error: `Line ${line}: ${LINE_TEXT.itemType}`, line };
    const qty = quantityOf(value.qty);
    if (qty === null) return { ok: false, error: `Line ${line}: ${LINE_TEXT.qty}`, line };
    const unitPricePaise = priceToPaise(value.price);
    if (unitPricePaise === null) return { ok: false, error: `Line ${line}: ${LINE_TEXT.price}`, line };
    lines.push({ itemTypeCode: code, qty, unitPricePaise });
  }
  return { ok: true, lines };
}

/**
 * Whether the neutral range note shows under a line: the price parses, the item type is known and the price is outside its range (the rule is `priceOutsideRange`, the same as
 * the API's `price_range.py`). It never blocks anything: a price that does not parse simply shows no note (its own sentence appears when the form is sent).
 */
export function showRangeNote(value: LineValues, types: ItemType[]): boolean {
  const paise = priceToPaise(value.price);
  const type = types.find((t) => t.code === value.code.trim());
  return paise !== null && type !== undefined && priceOutsideRange(paise, type.min_price_paise, type.max_price_paise);
}
