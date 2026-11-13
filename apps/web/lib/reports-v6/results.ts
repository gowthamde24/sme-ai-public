import { shiftDay, todayInIndia } from "@/components/v2/app/visits/dates";
import type { OutreachReport, SourceRow } from "@/lib/outreach/types";
import { weekRange } from "@/lib/report/week";

/**
 * Reports of design system v6 (owner 13 Nov 2026): RESULTS first, no vanity metrics. The story is a funnel (enquiries, called, visits, quotes, won), then which sources brought visits, then what a visit cost in rupees. A count of activity on its own
 * (calls made, messages sent, minutes) is not shown. Pure: no request, no React.
 */
export const RANGES = ["week", "7", "30"] as const;
export type RangeKey = (typeof RANGES)[number];
export const isRangeKey = (v: unknown): v is RangeKey => typeof v === "string" && (RANGES as readonly string[]).includes(v);
export type DayRange = { key: RangeKey; from: string; to: string };

/** The days of a range, India dates: this week (Monday to today), the last 7 days or the last 30 days (both end today). */
export function rangeOf(key: RangeKey, now: number): DayRange {
  const today = todayInIndia(now);
  if (key === "week") return { key, from: weekRange(now).from, to: today };
  return { key, from: shiftDay(today, key === "7" ? -6 : -29), to: today };
}

export const STAGES = ["enquiries", "called", "visits", "quotes", "won"] as const;
export type StageId = (typeof STAGES)[number];
/** What each step counted, or null where it could not be read (the funnel then leaves it out and says so). */
export type StageCounts = Record<StageId, number | null>;
export type FunnelStage = { id: StageId; value: number | null; /** The count of the step before it (the nearest one that could be read); null for the first step. */ previous: number | null };

export function buildFunnel(counts: StageCounts): FunnelStage[] {
  let previous: number | null = null;
  return STAGES.map((id) => {
    const value = counts[id];
    const stage: FunnelStage = { id, value, previous };
    if (value !== null) previous = value;
    return stage;
  });
}

/** The width of each bar, a whole number 0 to 100 of the largest step; a step that could not be read is 0. A bar that has a value is never thinner than 2 so it can be seen. */
export function barWidths(values: ReadonlyArray<number | null>): number[] {
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  return values.map((v) => (v === null || max === 0 || v <= 0 ? 0 : Math.max(2, Math.round((v / max) * 100))));
}

/** "Called" is the people the assistant reached: the calls that were answered, never more than the enquiries when those are known. */
export function calledCount(report: Pick<OutreachReport["total"], "calls" | "connectedRate" | "leads">): number {
  return Math.min(report.leads, Math.round((report.calls * report.connectedRate) / 100));
}

export type SourceResult = { source: string; enquiries: number; visits: number; costPerVisitPaise: number | null };
/** The sources that brought visits, most visits first (ties: most enquiries); sources with none are left to the end, then by name. */
export function sourceResults(rows: readonly SourceRow[]): SourceResult[] {
  return rows
    .map((r) => ({ source: r.source, enquiries: r.leads, visits: r.bookings, costPerVisitPaise: r.costPerBookingPaise }))
    .sort((a, b) => b.visits - a.visits || b.enquiries - a.enquiries || a.source.localeCompare(b.source));
}

/** The sources with a cost per visit, the cheapest first (a source with no visit has no cost: it is not here). */
export function costResults(rows: readonly SourceResult[]): { source: string; paise: number }[] {
  return rows.filter((r): r is SourceResult & { costPerVisitPaise: number } => r.costPerVisitPaise !== null).map((r) => ({ source: r.source, paise: r.costPerVisitPaise })).sort((a, b) => a.paise - b.paise);
}

/** True when there is nothing worth a page: no step has a number above zero and no source brought a visit. */
export function noResults(counts: StageCounts, sources: readonly SourceResult[]): boolean {
  return STAGES.every((s) => (counts[s] ?? 0) === 0) && sources.every((s) => s.visits === 0 && s.enquiries === 0);
}

export type QuoteLike = { total_paise: number; created_at: string; status: string };
/** The quotes made in the range (India days) that are still alive (not rejected or replaced), and what they add up to. */
export function quoteFigures(quotes: readonly QuoteLike[], range: Pick<DayRange, "from" | "to">): { count: number; paise: number } {
  let count = 0;
  let paise = 0;
  for (const q of quotes) {
    if (q.status === "rejected" || q.status === "superseded") continue;
    const day = todayInIndia(Date.parse(q.created_at));
    if (day < range.from || day > range.to) continue;
    count += 1;
    paise += q.total_paise;
  }
  return { count, paise };
}
