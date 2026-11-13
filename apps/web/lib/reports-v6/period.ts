import { isDay, shiftDay, todayInIndia } from "@/components/v2/app/visits/dates";

/**
 * The period of the Reports page (approved mock): Today, Last 14 days (the default), This month, or a Custom pair of days. All India dates. `previous` is the stretch of the same length right before it, for "up 22 percent vs the previous 14 days".
 * A custom period is at most 92 days, never in the future, and a wrong or back-to-front pair falls back to the last 14 days. Pure.
 */
export const PERIODS = ["today", "14", "month", "custom"] as const;
export type PeriodKey = (typeof PERIODS)[number];
export const MAX_CUSTOM_DAYS = 92;

export type Period = { key: PeriodKey; from: string; to: string; /** every day from `from` to `to` */ days: string[]; previous: { from: string; to: string } };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const daysBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_CUSTOM_DAYS + 1; d = shiftDay(d, 1)) out.push(d);
  return out;
};

function build(key: PeriodKey, from: string, to: string): Period {
  const days = daysBetween(from, to);
  return { key, from, to, days, previous: { from: shiftDay(from, -days.length), to: shiftDay(from, -1) } };
}

export function periodOf(query: Readonly<Record<string, string | string[] | undefined>>, now: number): Period {
  const today = todayInIndia(now);
  const key = first(query.range);
  if (key === "today") return build("today", today, today);
  if (key === "month") return build("month", `${today.slice(0, 7)}-01`, today);
  if (key === "custom") {
    const from = first(query.from);
    const to = first(query.to);
    if (isDay(from) && isDay(to) && from <= to && to <= today && daysBetween(from, to).length <= MAX_CUSTOM_DAYS) return build("custom", from, to);
  }
  return build("14", shiftDay(today, -13), today);
}

/** The address of the page for a period. */
export function periodHref(base: string, key: PeriodKey, custom?: { from: string; to: string }): string {
  if (key === "14") return `${base}/report`;
  if (key === "custom" && custom) return `${base}/report?range=custom&from=${custom.from}&to=${custom.to}`;
  return `${base}/report?range=${key}`;
}
