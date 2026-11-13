import { todayInIndia } from "@/components/v2/app/visits/dates";

import type { Period } from "./period";

/**
 * The day-by-day numbers of the Reports page (approved mock), worked out from what the API already gives (the leads with their arrival time and source, the visits of the period and the period before it, the orders those visits ended in, the calls with what each cost the
 * customer). Pure: nothing is read or guessed here. A number the API cannot give is left out by the page and said so, never filled in. All days are India days.
 */
export const indiaDay = (iso: string): string => (Number.isNaN(Date.parse(iso)) ? "" : todayInIndia(Date.parse(iso)));

const inRange = (day: string, from: string, to: string): boolean => day !== "" && day >= from && day <= to;

/** How many of these moments fall on each day of the period (a moment outside it is not counted). */
export function countPerDay(moments: readonly string[], days: readonly string[]): number[] {
  const at = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const m of moments) {
    const i = at.get(indiaDay(m));
    if (i !== undefined) out[i] += 1;
  }
  return out;
}

export type LeadLike = { createdAt: string; source: string | null };
/** Enquiries: the leads that arrived in the period, per day, the count in the period before, and where they came from (most first; leads with no source are "other"). */
export function enquiryFigures(leads: readonly LeadLike[], period: Pick<Period, "days" | "previous">): { perDay: number[]; total: number; previous: number; sources: { source: string; count: number }[] } {
  const perDay = countPerDay(leads.map((l) => l.createdAt), period.days);
  const from = period.days[0];
  const to = period.days[period.days.length - 1];
  const counts = new Map<string, number>();
  let previous = 0;
  for (const l of leads) {
    const d = indiaDay(l.createdAt);
    if (inRange(d, from, to)) counts.set(l.source ?? "other", (counts.get(l.source ?? "other") ?? 0) + 1);
    else if (inRange(d, period.previous.from, period.previous.to)) previous += 1;
  }
  const sources = [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return { perDay, total: perDay.reduce((s, n) => s + n, 0), previous, sources };
}

export type VisitLike = { date: string; status: string; outcome: string | null; order_id: string | null };
/** Visits: those booked (not cancelled) per day in the period, the count in the period before, and the ones that ended in a purchase. */
export function visitFigures(visits: readonly VisitLike[], period: Pick<Period, "days" | "previous">): { perDay: number[]; total: number; previous: number; bought: VisitLike[] } {
  const at = new Map(period.days.map((d, i) => [d, i]));
  const perDay = period.days.map(() => 0);
  let previous = 0;
  const bought: VisitLike[] = [];
  for (const v of visits) {
    if (v.status === "cancelled") continue;
    const i = at.get(v.date);
    if (i !== undefined) {
      perDay[i] += 1;
      if (v.outcome === "bought") bought.push(v);
    } else if (inRange(v.date, period.previous.from, period.previous.to)) previous += 1;
  }
  return { perDay, total: perDay.reduce((s, n) => s + n, 0), previous, bought };
}

/** Sales from visits: what the orders of the visits that ended in a purchase add up to, per day of the visit and in all, the same for the period before, and how many orders could not be found (their money is not counted, and the page says so). */
export function salesFigures(visits: readonly VisitLike[], orderPaise: ReadonlyMap<string, number>, period: Pick<Period, "days" | "previous">): { perDay: number[]; total: number; previous: number; missing: number } {
  const at = new Map(period.days.map((d, i) => [d, i]));
  const perDay = period.days.map(() => 0);
  let previous = 0;
  let missing = 0;
  for (const v of visits) {
    if (v.status === "cancelled" || v.outcome !== "bought") continue;
    const paise = v.order_id ? orderPaise.get(v.order_id) : undefined;
    const i = at.get(v.date);
    if (i === undefined && !inRange(v.date, period.previous.from, period.previous.to)) continue;
    if (paise === undefined) {
      if (i !== undefined) missing += 1;
      continue;
    }
    if (i !== undefined) perDay[i] += paise;
    else previous += paise;
  }
  return { perDay, total: perDay.reduce((s, n) => s + n, 0), previous, missing };
}

export type Change = { dir: "up" | "down" | "same"; diff: number; /** whole percent of the earlier figure; null when the earlier figure was zero */ percent: number | null };
export function change(now: number, before: number): Change {
  const diff = now - before;
  return { dir: diff > 0 ? "up" : diff < 0 ? "down" : "same", diff: Math.abs(diff), percent: before > 0 ? Math.round((Math.abs(diff) / before) * 100) : null };
}

export type CallLike = { createdAt: string; direction: "inbound" | "outbound"; costPaise: number | null };
/** What the calls of the period cost the customer, in paise (calls with no cost on them are not counted; null when none had one). */
export function callCost(calls: readonly CallLike[], period: Pick<Period, "days">): number | null {
  const from = period.days[0];
  const to = period.days[period.days.length - 1];
  let sum = 0;
  let any = false;
  for (const c of calls) {
    if (!inRange(indiaDay(c.createdAt), from, to) || c.costPaise === null) continue;
    sum += c.costPaise;
    any = true;
  }
  return any ? sum : null;
}

export const HEAT_FIRST_HOUR = 9;
export const HEAT_HOURS = 12; // 9 am to 8 pm
const IST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", hourCycle: "h23" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Busiest times: the calls that CAME IN, by weekday (Monday first) and hour (9 am to 8 pm, India time). `total` is every incoming call counted in the grid; `busiest` is the best two hours in a row on the best weekday (null when nothing was counted). */
export function heatmap(calls: readonly CallLike[]): { grid: number[][]; total: number; max: number; busiest: { weekday: number; fromHour: number; toHour: number } | null } {
  const grid = WEEKDAYS.map(() => new Array<number>(HEAT_HOURS).fill(0));
  let total = 0;
  for (const c of calls) {
    if (c.direction !== "inbound" || Number.isNaN(Date.parse(c.createdAt))) continue;
    const parts = IST.formatToParts(new Date(c.createdAt));
    const wd = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const col = hour - HEAT_FIRST_HOUR;
    if (wd < 0 || col < 0 || col >= HEAT_HOURS) continue;
    grid[wd][col] += 1;
    total += 1;
  }
  const max = Math.max(0, ...grid.flat());
  let busiest: { weekday: number; fromHour: number; toHour: number } | null = null;
  let best = 0;
  grid.forEach((row, wd) => {
    for (let c = 0; c < HEAT_HOURS - 1; c++) {
      const s = (row[c] + row[c + 1]) * 1000 + row[c]; // the best pair; of equals, the one that starts at the busier hour
      if (s > best && row[c] + row[c + 1] > 0) {
        best = s;
        busiest = { weekday: wd, fromHour: HEAT_FIRST_HOUR + c, toHour: HEAT_FIRST_HOUR + c + 2 };
      }
    }
  });
  return { grid, total, max, busiest };
}
