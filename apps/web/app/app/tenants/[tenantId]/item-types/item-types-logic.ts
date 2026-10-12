/**
 * Pure logic of the Item types page (no server, no React). A price is typed in RUPEES and read into integer paise by the same reader the typed-price quote form uses (two digits move
 * across the point; at most two decimals; no sign, exponent, comma or letter): no floating point. Every rule here is GUIDANCE for the screen; the API and the database check every limit again.
 * Sentences are OUR wording and repeat nothing the person typed.
 */
import { PRICE_LIMITS, type ItemType, type SaveItemTypeInput } from "@/lib/api/item-types";

import { priceToPaise } from "../enquiries/manual-quote-logic";
import { makeT, type Say } from "@/components/v2/app/words";

export const CODE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$/;
export const MAX_NAME = 200;
export const MAX_POSITION = 10_000;
const POSITION = /^[0-9]{1,5}$/;

/** What a person typed (text, exactly as typed). `active` is the tick box. */
export interface ItemTypeValues {
  name: string;
  code: string;
  position: string;
  active: boolean;
  lowest: string;
  highest: string;
}

export const TEXT = {
  name: "Name: enter 1 to 200 characters.",
  code: "Code: enter 1 to 20 letters, digits, hyphens or underscores, starting with a letter or a digit. It can never be changed.",
  position: "Order: enter a whole number from 0 to 10,000, using digits only. 0 comes first.",
  lowest: "Lowest price: leave it empty for none, or enter rupees with at most two digits after the point, from 0.01 to 10,00,000.",
  highest: "Highest price: leave it empty for none, or enter rupees with at most two digits after the point, from 0.01 to 10,00,000.",
  order: "The lowest price must not be above the highest price.",
} as const;
export const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";
export const NOT_AVAILABLE = "This workspace is not available.";
export const RANGE_SENTENCE = "A price outside the lowest and highest price only gives a warning when a quote is made. It never stops a quote.";
export const CODE_SENTENCE = "The code is typed once and can never be changed. An item type can never be deleted, only switched off.";

export type ItemTypeResult = { ok: true; input: SaveItemTypeInput } | { ok: false; error: string };

/** An optional rupee amount: empty is "none"; anything else must read as a price. `undefined` means the text is not acceptable. */
function optionalPrice(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  return priceToPaise(text) ?? undefined;
}

/**
 * The item type a person typed, as the request's input, or the first problem with OUR sentence. For a new type pass `requireCode` (the code is read and checked); for an edit the code comes
 * from the page and is passed as `code`.
 */
export function itemTypeFromForm(values: ItemTypeValues, code: string): ItemTypeResult {
  const name = values.name.trim();
  if (name === "" || name.length > MAX_NAME) return { ok: false, error: TEXT.name };
  if (!CODE_PATTERN.test(code)) return { ok: false, error: TEXT.code };
  const position = values.position.trim();
  if (!POSITION.test(position) || Number(position) > MAX_POSITION) return { ok: false, error: TEXT.position };
  const lowest = optionalPrice(values.lowest);
  if (lowest === undefined) return { ok: false, error: TEXT.lowest };
  const highest = optionalPrice(values.highest);
  if (highest === undefined) return { ok: false, error: TEXT.highest };
  if (lowest !== null && highest !== null && lowest > highest) return { ok: false, error: TEXT.order };
  return { ok: true, input: { code, name, position: Number(position), active: values.active, minPricePaise: lowest, maxPricePaise: highest } };
}

/** Integer paise as the rupee text a person would type back (2500, 999.99, 0.05): digits only, no grouping, no trailing zeros. */
export function paiseToRupeesText(paise: number | null): string {
  if (paise === null) return "";
  if (!Number.isSafeInteger(paise) || paise < PRICE_LIMITS.minPaise) return "";
  const whole = Math.floor(paise / 100);
  const part = paise % 100;
  if (part === 0) return String(whole);
  return `${whole}.${String(part).padStart(2, "0").replace(/0$/, "")}`;
}

/** The item types as the page lists them: the owner's order, then by code. (The API already sends them so; this keeps the screen right if it ever does not.) */
export function inListOrder(types: ItemType[]): ItemType[] {
  return [...types].sort((a, b) => a.position - b.position || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export type Refusal = { error: string; reason?: "mfa" };

/** ONE sentence of OUR wording for each closed code the item-type routes return. Nothing the API, the database or the person typed is repeated. */
export function saveRefusal(status: number, code: string, t: Say = makeT()): Refusal {
  if (code === "mfa_required") return { reason: "mfa", error: t("it.changing_item_types_needs_your_authenticator") };
  if (code === "forbidden") return { error: t("it.your_role_cannot_change_item_types") };
  if (code === "validation_error") return { error: t("it.a_name_a_number_or_a") };
  if (code === "invalid_value") return { error: t("it.the_lowest_price_is_above_the") };
  if (code === "not_found" || status === 404) return { error: t("it.workspace_not_available") };
  if (status === 429 || code === "rate_limited") return { error: t("it.too_many_requests_wait_a_moment") };
  if (code === "token_expiring") return { error: t("it.your_session_is_about_to_expire") };
  if (status === 503 || status === 502 || code === "quotes_unavailable" || code === "upstream_error" || code === "api_unreachable") return { error: t("it.item_types_are_not_available_right") };
  return { error: t("it.could_not_save_this_try_again") };
}
