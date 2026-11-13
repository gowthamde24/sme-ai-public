/**
 * How the staff console writes times and counts. Times come from the API as ISO instants and are written in India time (Asia/Kolkata), never the server's or the browser's zone; "ago" is worked out against the time the API answered
 * (`generated_at`), so a page and its test always agree. Pure: no request API.
 */
const ZONE = "Asia/Kolkata";
const dayKey = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** "5:42 pm" in India time. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/\s?([ap]m)$/i, (_m, p: string) => ` ${p.toLowerCase()}`);
}

/** "13 Nov" in India time. */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, day: "numeric", month: "short" }).format(new Date(iso));
}

/** "13 Nov, 5:42 pm". */
export function dateTime(iso: string): string {
  return `${shortDate(iso)}, ${clockTime(iso)}`;
}

/** "2 min ago", "3 h ago", "Yesterday", "2 days ago", then the date; "No activity yet" for none. */
export function ago(iso: string | null, nowIso: string): string {
  if (!iso) return "No activity yet";
  const then = new Date(iso);
  const now = new Date(nowIso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const days = Math.round((Date.parse(`${dayKey(now)}T00:00:00Z`) - Date.parse(`${dayKey(then)}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return shortDate(iso);
}

/** "12 min", "1 h", "2 h 30 min" for a wait. */
export function waiting(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 || h >= 10 ? `${h} h` : `${h} h ${m} min`;
}

/** 3412 -> "3,412" (the Indian grouping the rupee texts use: 3,412 and 2,41,800). */
export const count = (n: number): string => new Intl.NumberFormat("en-IN").format(n);

/** 98.6 -> "98.6", 98 -> "98" (no trailing zero). */
export const percentText = (n: number): string => (Math.round(n * 10) / 10).toString();

/** "Dharmavaram" etc. stay as the API wrote them; a plan or town that is missing is not drawn as a gap. */
export const orDash = (s: string): string => (s.trim() === "" ? "—" : s);

/** Whole seconds as "1:24" (calls in the support view). */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
