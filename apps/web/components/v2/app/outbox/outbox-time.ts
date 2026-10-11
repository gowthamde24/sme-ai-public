import { dayText } from "../date-words";
import { isDay, shiftDay, todayInIndia } from "../visits/dates";
import { indiaClock, indiaDay } from "../today/time";

/**
 * The time on an Outbox row, in the Indian day: the clock for something from today ("9:00"), else the day and the clock ("13 Oct, 21:15"). `now` (ms) is passed in so the page and a test agree.
 */
export function stamp(iso: string, now: number, lang = "en"): string {
  const clock = indiaClock(iso);
  if (indiaDay(iso) === indiaDay(new Date(now).toISOString())) return clock;
  const [y, m, d] = indiaDay(iso).split("-").map(Number);
  return `${dayText(lang, y, m, d, { month: "short" })}, ${clock}`;
}

/** The filters in the address: a part of the customer's name and two India dates (both included). Anything that is not a real date is dropped, and a "to" before the "from" is dropped too. */
export type LogFilters = { q: string; from: string | null; to: string | null };
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

export function parseFilters(raw: Record<string, string | string[] | undefined>, now: number): LogFilters {
  const q = first(raw.q).trim().slice(0, 100);
  let from = isDay(first(raw.from)) ? first(raw.from) : null;
  let to = isDay(first(raw.to)) ? first(raw.to) : null;
  // an older link said `range=today` or `range=7d`
  const range = first(raw.range);
  if (!from && !to && (range === "today" || range === "7d")) {
    to = todayInIndia(now);
    from = range === "today" ? to : shiftDay(to, -6);
  }
  if (from && to && to < from) to = null;
  return { q, from, to };
}

/** The two quick choices next to the dates: today, and the last seven days (today and the six before). */
export function presetDates(now: number): { today: LogFilters; week: LogFilters } {
  const today = todayInIndia(now);
  return { today: { q: "", from: today, to: today }, week: { q: "", from: shiftDay(today, -6), to: today } };
}
