import { formatRupeesShort } from "@/lib/money";

/**
 * How the Calls page writes lengths and costs (approved mock): a length as "4:12" (minutes and seconds, no leading zero on the minutes), a cost as "₹22.5" (one decimal when there are paise, none when it is a whole rupee). Pure.
 */
export const clockShort = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

export function rupeeCost(paise: number): string {
  return formatRupeesShort(paise).replace(/(\.\d)0$/, "$1"); // ₹22.50 -> ₹22.5, ₹17 stays, ₹2.53 stays
}
