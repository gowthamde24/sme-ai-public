import type { SettingsInput } from "./types";

/** The most a monthly limit can be: 10 lakh rupees, in paise (a typing mistake is refused, not saved). */
export const MAX_CAP_PAISE = 100_000_000;
const CODE = /^[a-z0-9_]{1,40}$/;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const pack = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" && CODE.test(v) ? v : undefined);
const cap = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_CAP_PAISE ? v : null);

/** What the browser sent for the two switches, checked: all fields, the right types, caps in whole paise. null = refuse (`invalid`). */
export function parseSettingsInput(input: unknown): SettingsInput | null {
  if (!isRec(input)) return null;
  const am = pack(input.autoMinutesPack);
  const ag = pack(input.autoMessagesPack);
  const ac = cap(input.autoMonthlyCapPaise);
  const oc = cap(input.overageMonthlyCapPaise);
  if (am === undefined || ag === undefined || ac === null || oc === null) return null;
  if (typeof input.overageMinutes !== "boolean" || typeof input.overageMessages !== "boolean") return null;
  return { autoMinutesPack: am, autoMessagesPack: ag, autoMonthlyCapPaise: ac, overageMinutes: input.overageMinutes, overageMessages: input.overageMessages, overageMonthlyCapPaise: oc };
}

/** Rupees as typed ("2,000", "2000", "2000.50") to whole paise; null when it is not a plain amount. */
export function rupeesToPaise(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
