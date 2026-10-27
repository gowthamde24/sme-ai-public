import type { Meter } from "./types";

/**
 * The small pure parts of the top-up screens: India days and month windows, the day a meter will run out at this period's pace, the alert level (80 and 100 percent) and the wording of a count. No request, no cookie, no clock
 * of its own (every function takes `now`), so the boundaries are tested without a browser. Nothing here calculates money: the pro-rata maths is the API's (and the mock's own copy lives in lib/topups/mock.ts).
 */
const DAY = 86_400_000;
const IST = "Asia/Kolkata";

/** The India calendar day (YYYY-MM-DD) of a moment. */
export function istDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
/** Midnight at the start of an India day, as a moment (India has no daylight saving: always +05:30). */
export const startOfDay = (day: string): Date => new Date(`${day}T00:00:00+05:30`);

/** The day after / before a plain day, in plain days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole days from `from` to `to` (both plain days; negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/** The billing month in India time that holds `now`: first and last day, the days in it, and the days left counting today (the API counts the same way). */
export function monthPeriod(now: Date): { start: string; end: string; days: number; daysLeft: number } {
  const today = istDay(now);
  const [y, m] = today.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end, days: daysBetween(start, end) + 1, daysLeft: daysBetween(today, end) + 1 };
}

/**
 * The India day an allowance runs out at the pace of the period so far: used / days gone, carried forward from the start of the period. null when nothing is used, when there is no ceiling, when the pace does not use it
 * up before the last day of the period, and when it is already used up (the screens then say so instead of a date). The first day counts as a whole day so that a first morning's burst does not predict an absurd date.
 */
export function projectRunOut(input: { used: number; allowance: number | null; periodStart: string; periodEnd: string; now: Date }): string | null {
  const { used, allowance, periodStart, periodEnd, now } = input;
  if (allowance === null || allowance <= 0 || used <= 0 || used >= allowance) return null;
  const gone = Math.max(1, (now.getTime() - startOfDay(periodStart).getTime()) / DAY);
  const perDay = used / gone;
  const daysToEmpty = allowance / perDay;
  const day = istDay(new Date(startOfDay(periodStart).getTime() + daysToEmpty * DAY));
  return day > periodEnd ? null : day;
}

/** 0 below 80 percent, 80 from 80 percent, 100 when stopped: the level an alert is made for. */
export function alertLevel(m: Pick<Meter, "state">): 0 | 80 | 100 {
  return m.state === "stopped" ? 100 : m.state === "notice" ? 80 : 0;
}
/** The meter that needs the owner first: a stopped one before a noticed one; minutes before messages when they are level. */
export function worstMeter<T extends Pick<Meter, "state">>(a: T, b: T): T | null {
  const la = alertLevel(a);
  const lb = alertLevel(b);
  if (la === 0 && lb === 0) return null;
  return lb > la ? b : a;
}

/** A count for people: whole numbers as they are, a fraction with one decimal ("241.5"), grouped the Indian way. */
export function count(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(rounded);
}

/** "21 Nov" for a plain day (English month names; the other languages get the numbers the same way, like the rest of the plan screens). */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00Z`));
}
export function dayLabelLong(day: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`));
}
/** The India day of an ISO moment, for a table of what was bought. */
export const dayOfIso = (iso: string): string => istDay(new Date(iso));
