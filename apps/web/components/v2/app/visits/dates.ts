/**
 * Calendar days of the Visits page (job AV). A "day" is the India calendar date as `YYYY-MM-DD`, exactly as the API names it. Nothing here depends on the server's or the browser's zone: a date is
 * moved and written in UTC (a date has no clock), and "today" is read in Asia/Kolkata. A test pins the clock with the `now` argument.
 */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in the shape `YYYY-MM-DD` (2026-02-30 is not one). */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Today's India date. */
export function todayInIndia(now: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The date `n` days after (or before) `day`. */
export function shiftDay(day: string, n: number): string {
  const m = DAY.exec(day);
  if (!m) return day;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
}

/** "Wednesday, 14 October 2026" in the person's language (the other languages get the date the way their own locale writes it). */
export function dayHeading(day: string, lang: string): string {
  const m = DAY.exec(day);
  if (!m) return day;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const parts = new Intl.DateTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(date);
  if (lang !== "en") return parts.map((p) => p.value).join("");
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`;
}

/** "Wed 14 Oct": a short form for a line of text. */
export function dayShort(day: string, lang: string): string {
  const m = DAY.exec(day);
  if (!m) return day;
  return new Intl.DateTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}

/** The weekday names, Monday first, in the person's language (for the opening hours). */
export function weekdayName(index: number, lang: string): string {
  // 2026-10-05 is a Monday
  return new Intl.DateTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { timeZone: "UTC", weekday: "long" }).format(new Date(Date.UTC(2026, 9, 5 + index)));
}


/** "2 Oct 2026": the Indian day of a moment, written the Indian way (`lang` picks the month's name). */
export function indiaDayText(iso: string, lang = "en"): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-IN" : `${lang}-IN`, { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
