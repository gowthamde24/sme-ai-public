import { formatRupeesShort } from "@/lib/money";

import type { QtyUnit, SellStyle, SizeUnit } from "./types";

/** Money as the owner says it: ₹8,500 (never paise unless there are some). */
export const rupeeText = (paise: number): string => formatRupeesShort(paise);

const LAKH = 10_000_000; // 1 lakh rupees in paise
const CRORE = 1_000_000_000;
const trim = (n: number): string => String(Math.round(n * 100) / 100);
/** A property's price the way it is spoken: ₹68 lakh, ₹1.2 crore; under a lakh, plain rupees. Numbers only: the unit words are English in every language, as in the old pages. */
export function bigMoneyText(paise: number): string {
  if (paise >= CRORE) return `₹${trim(paise / CRORE)} crore`;
  if (paise >= LAKH) return `₹${trim(paise / LAKH)} lakh`;
  return rupeeText(paise);
}
/** "₹68 lakh", "1.2 crore", "6800000", "₹ 24,000" to paise, or null. At most 1,000 crore. */
export function parseBigMoney(text: string): number | null {
  const m = /^\s*₹?\s*([\d,]+(?:\.\d{1,2})?)\s*(lakhs?|lacs?|l|crores?|cr)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const paise = Math.round(n * 100 * (unit.startsWith("cr") ? 10_000_000 : unit === "" ? 1 : 100_000));
  return paise >= 100 && paise <= 1_000 * CRORE ? paise : null;
}
/** A whole number typed by the owner ("4", "1,150"), 1 to `max`, or null. */
export function wholeNumber(text: string, max = 1_000_000): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= max ? n : null;
}
/** The same, but 0 is allowed (a count of stock). */
export function countNumber(text: string, max = 1_000_000): number | null {
  const t = text.replace(/,/g, "").trim();
  if (t === "0") return 0;
  return wholeNumber(t, max);
}
export const SIZE_SHORT: Record<SizeUnit, string> = { sq_ft: "sq ft", sq_yd: "sq yd", acre: "acre", cent: "cent" };
export const groupedNumber = (n: number): string => n.toLocaleString("en-IN");
/** An ISO day (2026-12-02) as "2 Dec"; anything else is "". */
export function shortDay(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : "";
}
export const dayFromShort = (iso: string | null): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "");

/** Examples that are DATA, not words: the sentence the Say it box shows (English closed words and numbers, which are what it understands), and the names, places and batches of the fields' placeholders. The same in every language, like a price. */
export const SAY_EXAMPLE: Record<SellStyle, string> = {
  products: "“Kanjivaram silk saree, 8,500 rupees, red and green, 4 in stock.”",
  services: "“Haircut, 30 minutes, 200 rupees, book any day.”",
  courses: "“NEET crash course, Mon to Fri 6 pm, 24,000 rupees, 30 seats.”",
  properties: "“2 BHK flat in Kukatpally, 1,150 sq ft, 68 lakh, available.”",
  pricelist: "“Cotton shirting 40s, minimum 50 metres, 118 rupees.”",
};
export const NAME_EXAMPLE: Record<SellStyle, string> = { products: "Kanjivaram silk saree", services: "Haircut", courses: "NEET crash course", properties: "2 BHK flat", pricelist: "Cotton shirting 40s" };
export const BATCH_EXAMPLE = "Mon to Fri, 6 pm";
export const PLACE_EXAMPLE = "Kukatpally";
export const NOTE_EXAMPLE = "3rd floor, corner plot";
/** The short unit of a rate ("50 m+"); a piece has none ("24+"). Written as it is in every language, like "sq ft". */
export const SHORT_UNIT: Record<QtyUnit, string> = { piece: "", metre: "m", kg: "kg", set: "set", dozen: "doz" };
