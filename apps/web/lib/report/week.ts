import { shiftDay, todayInIndia } from "@/components/v2/app/visits/dates";
import type { OutboxMessage } from "@/lib/api/outbox";
import type { ItemSummary } from "@/lib/api/catalogue";
import type { Visit } from "@/lib/api/visits";

/** The visits list answers at most this many visits (the API's limit): a week with this many is shown as "the first 300". */
export const VISIT_CAP = 300;

export interface WeekRange {
  /** Monday, India date `YYYY-MM-DD`. */
  from: string;
  /** Sunday. */
  to: string;
  today: string;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The India week (Monday to Sunday) that holds `now`. A date has no clock: the weekday is read in UTC from the date itself. */
export function weekRange(now: number): WeekRange {
  const today = todayInIndia(now);
  const m = DAY.exec(today);
  if (!m) return { from: today, to: today, today };
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const from = shiftDay(today, -sinceMonday);
  return { from, to: shiftDay(from, 6), today };
}

export interface VisitFigures {
  /** Visits made for the week, not counting the cancelled ones. */
  booked: number;
  /** Of those, the ones whose customer came (here now, or done). */
  arrived: number;
  /** Of those, the ones that ended in a purchase. */
  bought: number;
  noShow: number;
  cancelled: number;
  /** Booked visits on each day, Monday first. */
  perDay: number[];
  /** The list was full: the figures are for the first VISIT_CAP visits. */
  capped: boolean;
}

export function visitFigures(visits: readonly Visit[], range: Pick<WeekRange, "from">): VisitFigures {
  const out: VisitFigures = { booked: 0, arrived: 0, bought: 0, noShow: 0, cancelled: 0, perDay: [0, 0, 0, 0, 0, 0, 0], capped: visits.length >= VISIT_CAP };
  for (const v of visits) {
    if (v.status === "cancelled") {
      out.cancelled += 1;
      continue;
    }
    out.booked += 1;
    if (v.status === "arrived" || v.status === "completed") out.arrived += 1;
    if (v.status === "no_show") out.noShow += 1;
    if (v.outcome === "bought") out.bought += 1;
    const m = DAY.exec(v.date);
    const f = DAY.exec(range.from);
    if (m && f) {
      const gap = Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]))) / 86_400_000);
      if (gap >= 0 && gap < 7) out.perDay[gap] += 1;
    }
  }
  return out;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Approval {
  /** Median minutes from "waits for a person" to "approved", over the messages a person approved. */
  medianMinutes: number;
  count: number;
}

/** How fast a person said OK: only messages a person approved (`owner_approved`), made-to-decided. Null when there is nothing to measure. */
export function approvalFigure(messages: readonly OutboxMessage[]): Approval | null {
  const minutes: number[] = [];
  for (const m of messages) {
    if (m.reason !== "owner_approved" || !m.decided_at) continue;
    const gap = (Date.parse(m.decided_at) - Date.parse(m.created_at)) / 60_000;
    if (Number.isFinite(gap) && gap >= 0) minutes.push(gap);
  }
  const med = median(minutes);
  return med === null ? null : { medianMinutes: Math.round(med), count: minutes.length };
}

export interface SareeCount {
  id: string;
  name: string;
  count: number;
}
export interface SareeFigures {
  top: SareeCount[];
  /** Sent messages with photos that match no saree's cover photo (a photo that is not a cover, or a saree taken off). */
  unmatched: number;
  withPhotos: number;
}

/**
 * The sarees sent most, from the photos the sent messages carried. The API names a message's photos, not its saree, so a saree is found by its COVER photo (the catalogue list gives the cover); a message counts once
 * for each saree it shows. A message whose photos match no cover is counted in `unmatched` and said so on the screen. An aggregate API would make this exact (see the report of job BV).
 */
export function sareeFigures(messages: readonly OutboxMessage[], items: readonly Pick<ItemSummary, "id" | "name" | "cover">[], limit = 5): SareeFigures {
  const byCover = new Map<string, { id: string; name: string }>();
  for (const i of items) if (i.cover) byCover.set(i.cover.id, { id: i.id, name: i.name });
  const counts = new Map<string, SareeCount>();
  let unmatched = 0;
  let withPhotos = 0;
  for (const m of messages) {
    if (m.media.length === 0) continue;
    withPhotos += 1;
    const seen = new Set<string>();
    for (const p of m.media) {
      const item = byCover.get(p.photo_id);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        const c = counts.get(item.id) ?? { id: item.id, name: item.name, count: 0 };
        c.count += 1;
        counts.set(item.id, c);
      }
    }
    if (seen.size === 0) unmatched += 1;
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
  return { top, unmatched, withPhotos };
}

/** A part that could not be read is the string "error": the screen says so in that place only and never draws a zero for it. */
export type Part<T> = T | "error";

export interface ReportData {
  range: WeekRange;
  visits: Part<VisitFigures>;
  messages: Part<{ sent: number; waiting: number; blocked: number }>;
  /** null = no message a person approved this week yet. */
  approval: Part<Approval | null>;
  sarees: Part<SareeFigures & { capped: boolean }>;
  /** The share of this week's AI allowance used, 0 to 100. */
  aiPercent: Part<number>;
}
