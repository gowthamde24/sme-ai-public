/**
 * The Do-Not-Call list (JOBS, mock 08 part 2; contract section 6, FINAL 1.0): the numbers the assistant never calls or messages. The API sends a MASKED number (the web never holds the whole number of a person who said STOP), a reason CODE and a date;
 * the sentences are ours (`jobs.dnc.*`). Pure: no request, safe in the browser.
 */
export const DNC_REASONS = ["stop_whatsapp", "asked_on_call", "added_by_owner", "other"] as const;
export type DncReason = (typeof DNC_REASONS)[number];

/** One time the customer (or the owner, recording their yes) lifted the stop: when, how it was given (a closed word) and by whom. */
export type DncHistory = { at: string; how: string; by: "customer" | "owner_recorded" };
/** `addedBy` is the display name of the person who added an owner-added number; `history` is there once an entry was lifted (the customer came back). */
export type DncEntry = { id: string; phoneMasked: string; reason: DncReason; at: string; addedBy: string | null; history: readonly DncHistory[] };

/** Only a number the owner added may be removed; STOP from the customer and the legal or complaint rule stay (a lifted STOP is the customer's to do). */
export const dncRemovable = (e: Pick<DncEntry, "reason">): boolean => e.reason === "added_by_owner";
export type DncPage = { items: DncEntry[]; count: number; nextCursor: string | null };

export const dncReasonKey = (r: DncReason): string => `jobs.dnc.reason.${r}`;

/** The number as the API takes it: `+91` and ten digits starting with 6 to 9 (an Indian mobile). Accepts what people type: spaces, dashes, a leading 0, 91 or +91. null = not an Indian mobile number. */
export function indianMobile(typed: string): string | null {
  const digits = typed.replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;
  const only = digits.replace(/^\+/, "");
  const ten = only.length === 10 ? only : only.length === 11 && only.startsWith("0") ? only.slice(1) : only.length === 12 && only.startsWith("91") ? only.slice(2) : null;
  if (digits.startsWith("+") && !only.startsWith("91")) return null;
  return ten !== null && /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

/** "+91 98480 ••• 21": the first five digits and the last two, as the list shows a number. */
export function maskIndianMobile(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return `+91 ${d.slice(0, 5)} ••• ${d.slice(-2)}`;
}

/** What a masked number from the API may look like: digits, plus, spaces and the mask signs; anything else is not drawn. */
export const isMaskedNumber = (v: string): boolean => v.length >= 4 && v.length <= 32 && /^[+\d\s•*xX\-]+$/.test(v);
