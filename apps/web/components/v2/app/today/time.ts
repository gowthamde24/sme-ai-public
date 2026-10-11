/**
 * Moments for Today, all in the Indian day (the business is in India) with a fixed zone and locale, so the server and the browser draw the same text and a test can pin the clock.
 */
const clockParts = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));

/** "9:00", "18:05": 24-hour, no leading zero on the hour. */
export function indiaClock(iso: string): string {
  const parts = clockParts(iso);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${Number(get("hour"))}:${get("minute")}`;
}

/** The Indian calendar day of a moment as "YYYY-MM-DD". */
export function indiaDay(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "3h", "28m", "2d": how long ago (short, no words: the same in every language). */
export function ago(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** The time on a card: the clock ("8:42") for something from today, else how long ago ("1d"). `now` is a moment (ms), passed in so the page and a test agree. */
export function whenLabel(iso: string, now: number): string {
  return indiaDay(iso) === indiaDay(new Date(now).toISOString()) ? indiaClock(iso) : ago(iso, now);
}
