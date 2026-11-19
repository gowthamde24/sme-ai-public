import { formatRupeesShort } from "@/lib/money";

import type { SizeUnit } from "./types";

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
