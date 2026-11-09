import type { AiTeamDay, FlowKey, Helper, Lane, Mark, MarkKind, StatusNow } from "@/lib/api/ai-team";

/**
 * My AI team v2's day as the screen draws it (pure: no React, no request). Times are the business's, India time; the axis is its working day (opening hours, default 9:00–20:00), widened to the hour when a mark falls outside it.
 * A ⚑ mark from before the day (something still waiting since yesterday) is pinned at the start of the axis with "since …".
 */
const IST_OFFSET_MIN = 330;

/** Minutes since midnight, India time, of an ISO instant. */
export function minuteOfDay(iso: string): number {
  const ms = Date.parse(iso);
  const m = Math.floor(ms / 60_000) + IST_OFFSET_MIN;
  return ((m % 1440) + 1440) % 1440;
}
/** The India date (YYYY-MM-DD) of an ISO instant. */
export function dateOf(iso: string): string {
  return new Date(Date.parse(iso) + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
const hhmm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export const clock = (minute: number): string => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const clockOf = (iso: string): string => clock(minuteOfDay(iso));
/** "1:24" for 84 seconds. */
export const duration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
/** "₹184.50" (Indian grouping; whole rupees without paise). */
export function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export type Axis = { start: number; end: number; hours: number[] };
/** The axis: the day's opening hours, widened to whole hours around any mark of the day itself (and the now line, today). */
export function axisOf(day: AiTeamDay, nowMinute: number | null): Axis {
  let start = hhmm(day.day.opens);
  let end = hhmm(day.day.closes);
  if (end <= start) end = start + 60;
  for (const lane of day.lanes)
    for (const m of lane.marks) {
      if (dateOf(m.t) !== day.date) continue;
      const at = minuteOfDay(m.t);
      start = Math.min(start, Math.floor(at / 60) * 60);
      end = Math.max(end, Math.min(1440, Math.ceil((at + 1) / 60) * 60));
    }
  if (nowMinute !== null) {
    start = Math.min(start, Math.floor(nowMinute / 60) * 60);
    end = Math.max(end, Math.min(1440, Math.ceil((nowMinute + 1) / 60) * 60));
  }
  const hours: number[] = [];
  for (let h = Math.ceil(start / 60) * 60; h <= end; h += 60) hours.push(h);
  return { start, end, hours };
}
/** Where a minute falls on the axis, 0 to 100. */
export const pct = (axis: Axis, minute: number): number => Math.max(0, Math.min(100, ((minute - axis.start) / (axis.end - axis.start)) * 100));

export type Placed = Mark & { helper: Helper; minute: number; before: boolean };
/** A mark on the axis: its minute, or the axis start when it is from an earlier day (a ⚑ still waiting). */
export function place(day: AiTeamDay, lane: Lane, m: Mark, axis: Axis): Placed {
  const before = dateOf(m.t) < day.date;
  return { ...m, helper: lane.helper, minute: before ? axis.start : minuteOfDay(m.t), before };
}

/** The mark kinds behind each step of the flow strip: clicking a step shows only those. */
export const FLOW_KINDS: Record<FlowKey, readonly MarkKind[]> = {
  leads_in: ["lead_in"],
  enquiries: ["lead_in"],
  called: ["call"],
  interested: ["call"],
  quotes: ["quote", "quote_approved"],
  orders: ["order"],
  campus_visits: ["visit"],
  admissions: ["admission"],
  fees_collected: ["payment", "fee_reminder"],
};
export function shown(marks: readonly Mark[], filter: FlowKey | null): Mark[] {
  if (!filter) return [...marks];
  const kinds = FLOW_KINDS[filter];
  return marks.filter((m) => kinds.includes(m.kind));
}

/** Every mark of the day for the phone's vertical timeline: in time order (pinned ⚑ marks first), each with its helper. */
export function dayList(day: AiTeamDay, axis: Axis, filter: FlowKey | null): Placed[] {
  return day.lanes
    .flatMap((l) => shown(l.marks, filter).map((m) => place(day, l, m, axis)))
    .sort((a, b) => (a.before === b.before ? a.minute - b.minute || a.id.localeCompare(b.id) : a.before ? -1 : 1));
}

/** The words of a lane's live status ("● on call · Ramesh 0:42", "5 due · next 16:00", "1 waiting for you", "Paused"): a key of the page's words and its values. `elapsed` is the seconds since `since` (a call's timer). */
export function statusWords(s: StatusNow | null, elapsed: number | null): { key: string; vars: Record<string, string> } | null {
  if (!s) return null;
  switch (s.kind) {
    case "paused":
      return s.count ? { key: "aiteam.status.paused.waiting", vars: { count: String(s.count) } } : { key: "aiteam.status.paused", vars: {} };
    case "busy": {
      const time = elapsed !== null ? duration(Math.max(0, elapsed)) : "";
      return s.who ? { key: "aiteam.status.on_call", vars: { who: s.who, time } } : { key: "aiteam.status.on_call.anon", vars: { time } };
    }
    case "due":
      return s.at ? { key: "aiteam.status.due_next", vars: { count: String(s.count ?? 0), time: clockOf(s.at) } } : { key: "aiteam.status.due", vars: { count: String(s.count ?? 0) } };
    case "waiting":
      return { key: "aiteam.status.waiting_for_you", vars: { count: String(s.count ?? 0) } };
    case "idle":
      return { key: "aiteam.status.idle", vars: {} };
  }
}

/** The colour of each helper's lane (the app's own tokens; the ⚑ orange belongs to the marks waiting for the owner only). */
export const LANE_TONE: Record<Helper, { dot: string; mark: string; chip: string }> = {
  lead_catcher: { dot: "bg-info-text", mark: "bg-info-text", chip: "bg-info-bg text-info-text" },
  lead_finder: { dot: "bg-green-text", mark: "bg-green-text", chip: "bg-green-bg text-green-text" },
  caller: { dot: "bg-ink", mark: "bg-ink", chip: "bg-surface-2 text-ink" },
  followups: { dot: "bg-amber-text", mark: "bg-amber-text", chip: "bg-amber-bg text-amber-text" },
  quote_writer: { dot: "bg-info-text", mark: "bg-info-text", chip: "bg-info-bg text-info-text" },
  order_desk: { dot: "bg-green-text", mark: "bg-green-text", chip: "bg-green-bg text-green-text" },
  admissions: { dot: "bg-info-text", mark: "bg-info-text", chip: "bg-info-bg text-info-text" },
  fee_reminders: { dot: "bg-amber-text", mark: "bg-amber-text", chip: "bg-amber-bg text-amber-text" },
  notices: { dot: "bg-ink", mark: "bg-ink", chip: "bg-surface-2 text-ink" },
};

/** Fill "{name}" holes of a word. */
export const fill = (text: string, vars: Record<string, string> = {}): string => text.replace(/\{(\w+)\}/g, (m, n: string) => vars[n] ?? m);
