import { indiaClock, indiaDay } from "../today/time";

/**
 * The time on an Outbox row, in the Indian day: the clock for something from today ("9:00"), else the day and the clock ("13 Oct, 21:15"). `now` (ms) is passed in so the page and a test agree.
 */
export function stamp(iso: string, now: number, lang = "en"): string {
  const clock = indiaClock(iso);
  if (indiaDay(iso) === indiaDay(new Date(now).toISOString())) return clock;
  const day = new Intl.DateTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(iso));
  return `${day}, ${clock}`;
}

/** The moment a message is filed under for the day filter: when it goes out (held), when it went (sent), else when it was made. */
export function filedAt(m: { status: string; scheduled_for: string | null; sent_at: string | null; created_at: string }): string {
  if (m.status === "queued" && m.scheduled_for) return m.scheduled_for;
  if (m.status === "sent" && m.sent_at) return m.sent_at;
  return m.created_at;
}

export const RANGES = ["today", "7d"] as const;
export type Range = (typeof RANGES)[number];

/** Inside the range? "today" = the Indian day of `now`; "7d" = from the start of the Indian day six days ago. A message held for later (in the future) is always inside. */
export function inRange(iso: string, range: Range, now: number): boolean {
  if (range === "today") return indiaDay(iso) === indiaDay(new Date(now).toISOString()) || Date.parse(iso) > now;
  const from = indiaDay(new Date(now - 6 * 86_400_000).toISOString());
  return indiaDay(iso) >= from;
}
