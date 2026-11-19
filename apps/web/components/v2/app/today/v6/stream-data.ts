import type { Availability } from "../ask/ask-types";
import type { StoreToday, TodayData } from "../types";
import { topDecision } from "./band-data";
import { buildDay, type DayView } from "./day-data";
import type { VisitRow } from "./Lower";
import type { V6In } from "./types";

/**
 * The small pure parts of Today's v6 layout that two callers need: the whole page drawn at once (`TodayView`) and the page drawn in parts as they are read (`today-stream.tsx`). One place, so the two cannot disagree.
 */

/** Is the assistant there to be asked? (the command bar's state, from the helpers' status: the main helper idle or working = live) */
export function availabilityOf(team: TodayData["team"]): Availability {
  const main = team?.find((a) => a.agent === "main")?.state;
  return main === "idle" || main === "working" ? "live" : main === "switched_off" ? "switched_off" : "not_available";
}

/** The store today, when it could be read (else null: "At the store today" and the visits of "Your day" are left out, never guessed). */
export const readyStore = (store: TodayData["store"]): (StoreToday & { state: "ready" }) | null => (store?.state === "ready" ? store : null);

/** Today's visits for the v6 list: the time in India (24 hours), the name, the topic. */
export function visitRowsOf(ready: ReturnType<typeof readyStore>): VisitRow[] {
  return (ready?.visits ?? []).map((v) => ({ id: v.id, time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date(v.starts_at)), who: v.extra > 0 ? `${v.who} +${v.extra}` : v.who, line: v.topic }));
}

/** "Your day": today's calls (read by the page), the visits (the store's own list), the call-backs still planned (the people left to call in the approved job). */
export function dayViewOf(now: number, lower: Pick<V6In, "dayCalls" | "dayTransferred" | "working">, ready: ReturnType<typeof readyStore>): DayView {
  return buildDay({
    now,
    calls: lower.dayCalls,
    visits: ready ? ready.visits.map((v) => ({ startsAt: v.starts_at, who: v.who })) : null,
    sent: lower.dayTransferred,
    planned: lower.working && lower.working.waiting > 0 ? { n: lower.working.waiting, toMinute: lower.working.toMinute } : null,
  });
}

/** What the briefing's words are made of, from Today's data and the number of new enquiries (the menu's): what `TodayView` gives the band. */
export function briefOf(data: TodayData, newLeads: number | null) {
  const ready = readyStore(data.store);
  return { facts: { enquiries: newLeads, visits: ready ? ready.visits.length : null }, top: topDecision(data.needs), waiting: data.cards.waiting };
}
