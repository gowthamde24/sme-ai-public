/** The language tag and the structured time of a plan (C1's owner-language contract, 14 Nov 2026). In a file of their own: the browser voice reads them too, and turns.ts must not be pulled into the browser. */
export type PlanWhen = { date: string; fromMinute: number; toMinute: number | null };

/** The plan's `when` (C1's owner-language contract), or null when it is absent or not usable: a time that cannot be read is simply not drawn. */
export function parseWhen(v: unknown): PlanWhen | null {
  if (typeof v !== "object" || v === null) return null;
  const w = v as Record<string, unknown>;
  const minute = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 1440 ? x : null);
  const from = minute(w.from_minute);
  if (typeof w.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(w.date) || from === null) return null;
  return { date: w.date, fromMinute: from, toMinute: minute(w.to_minute) };
}
/** The language tag of a payload: a short lowercase code, or null. */
export const languageTag = (v: unknown): string | null => (typeof v === "string" && /^[a-z]{2,3}$/.test(v) ? v : null);
