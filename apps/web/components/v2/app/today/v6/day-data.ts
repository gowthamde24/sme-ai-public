/**
 * "Your day" (design system v6, the final Today): the timeline of the working day, 9 am to 9 pm in India. Calls are dots (the real calls of today), visits are green pins with the name and the time, a "Now" line, and the call-backs the assistant has planned are dashed circles
 * (the people still to call of the approved job, spread over the time that is left). Pure: no fetch, no React. A part that cannot be read is null and is not drawn.
 */
export const DAY_START = 9 * 60;
export const DAY_END = 21 * 60;

/** Where a minute of the day sits on the track, in per cent of the span (clamped to the track). */
const place = (minute: number, end: number): number => Math.round(Math.max(0, Math.min(100, ((minute - DAY_START) / (end - DAY_START)) * 100)) * 100) / 100;
/** With the standard window (9 am to 9 pm): a minute's place on the track. */
export const pctOf = (minute: number): number => place(minute, DAY_END);

const parts = (ms: number) => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: get("hour") * 60 + get("minute") };
};
/** The day (YYYY-MM-DD) and the minute of the day in India for an instant. */
export const indiaParts = (iso: string | number): { day: string; minute: number } => parts(typeof iso === "number" ? iso : Date.parse(iso));
export const clockText = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

export type DayCall = { pct: number; lane: 0 | 1 | 2; /** Calls that share this spot beyond the three drawn (a "+N" marker); 0 = none. */ more: number };
export type DayVisit = { pct: number; name: string; time: string };
export type DayView = {
  calls: DayCall[];
  visits: DayVisit[];
  planned: number[];
  /** The Now line: where it sits and its time ("10:40"); null outside the track. */
  now: { pct: number; time: string } | null;
  /** The hour lines of the grid, and the labels under them (every second hour). */
  grid: number[];
  hours: { pct: number; label: string }[];
  /** The summary line: calls handled, things sent to the person, the next planned call-backs and when they start. Each null = left out. */
  handled: number | null;
  sent: number | null;
  next: { n: number; time: string } | null;
};

const MAX_PLANNED = 12;
const PLANNED_GAP = 6;
/** Calls closer than this share of the track sit on one spot; at most three are drawn there. */
const SAME_SPOT = 0.8;

export function buildDay({ now, calls, visits, sent, planned }: { now: number; calls: readonly string[] | null; visits: readonly { startsAt: string; who: string }[] | null; sent: number | null; /** The people still to call of the approved job and the end of its calling hours (minute of the day); null = none planned. */ planned: { n: number; toMinute: number | null } | null }): DayView {
  const today = indiaParts(now);
  const callMinutes = (calls ?? []).map((c) => indiaParts(c)).filter((p) => p.day === today.day).map((p) => p.minute).sort((a, b) => a - b);
  const pins = (visits ?? []).map((v) => ({ ...indiaParts(v.startsAt), who: v.who })).filter((p) => p.day === today.day).sort((a, b) => a.minute - b.minute);
  // the track is 9 am to 9 pm; once it is later than that (or a call came later) it runs on to the next full hour, so nothing is pushed against the edge
  const lastSeen = Math.max(today.minute, ...callMinutes, ...pins.map((p) => p.minute));
  const end = Math.min(24 * 60, Math.max(DAY_END, Math.ceil(lastSeen / 60) * 60));
  const pct = (m: number) => place(m, end);
  // the call-backs start at the next half hour and follow each other, never past the end of the calling hours
  const start = Math.ceil((today.minute + 1) / 30) * 30;
  const limit = planned?.toMinute ?? DAY_END;
  const n = planned ? Math.min(planned.n, MAX_PLANNED) : 0;
  const plannedMinutes = Array.from({ length: n }, (_, i) => start + i * PLANNED_GAP).filter((m) => m <= Math.min(limit, end));
  const inRange = today.minute >= DAY_START && today.minute <= end;
  // dots: three lanes; calls on one spot are drawn up to three, the rest is a "+N" on the last of them
  const dots: DayCall[] = [];
  let spot: { at: number; count: number } | null = null;
  for (const m of callMinutes) {
    const x = pct(m);
    if (spot && x - spot.at < SAME_SPOT) {
      spot.count += 1;
      if (spot.count > 3) {
        dots[dots.length - 1].more = spot.count - 3;
        continue;
      }
    } else spot = { at: x, count: 1 };
    dots.push({ pct: x, lane: (dots.length % 3) as 0 | 1 | 2, more: 0 });
  }
  const hoursAll: number[] = [];
  for (let h = DAY_START / 60; h * 60 <= end; h += 1) hoursAll.push(h);
  return {
    calls: dots,
    visits: pins.map((p) => ({ pct: pct(p.minute), name: p.who, time: clockText(p.minute) })),
    planned: plannedMinutes.map(pct),
    now: inRange ? { pct: pct(today.minute), time: clockText(today.minute) } : null,
    grid: hoursAll.map((h) => pct(h * 60)),
    hours: hoursAll.filter((h, i) => i % 2 === 0).map((h) => ({ pct: pct(h * 60), label: hourLabel(h) })),
    handled: calls === null ? null : callMinutes.length,
    sent,
    next: plannedMinutes.length > 0 ? { n: plannedMinutes.length, time: clockText(plannedMinutes[0]) } : null,
  };
}
