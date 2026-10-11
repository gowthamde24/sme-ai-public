import type { NeedsCard, StoreToday, TodayData } from "@/components/v2/app/today/types";
import { shiftDay, todayInIndia } from "@/components/v2/app/visits/dates";
import { ApiAuthError } from "@/lib/api/client";
import { getAiUsageWeek, getSlots, getTodayVisits, listVisits } from "@/lib/api/visits";

/** A read that failed is its own answer (the screen says "Not available yet" in that place only); a rejected session still sends the person to sign in. */
function rethrowAuth(error: unknown): null {
  if (error instanceof ApiAuthError) throw error;
  return null;
}

/**
 * "At the store today" (`GET /visits/today`) and the first free time still to come (`GET /visits/slots?date=today`). The visits are what the section needs; if the slots cannot be read the section
 * is drawn without the "next free time" line. Any member reads, so any role is asked. null = the visits could not be read.
 */
export async function readStore(accessToken: string, tenantId: string, now: number): Promise<TodayData["store"]> {
  const [visits, slots] = await Promise.all([
    getTodayVisits(accessToken, tenantId).catch(rethrowAuth),
    getSlots(accessToken, tenantId, todayInIndia(now)).catch(rethrowAuth),
  ]);
  if (visits === null) return { state: "error" };
  const next = slots?.slots.find((x) => x.free > 0 && !x.past);
  const today: StoreToday = {
    visits: visits.items.map((v) => ({ id: v.id, starts_at: v.starts_at, who: v.who, extra: v.extra, topic: v.topic, status: v.status, here: v.visit_status === "arrived" })),
    slots: slots === null ? "unknown" : !slots.open ? "closed" : next ? "free" : "full",
    nextFree: next?.starts_at ?? null,
  };
  return { state: "ready", ...today };
}

const PROPOSAL_DAYS = 61; // the API reads at most 62 days at a time

/**
 * The visits Agent OWL proposed that nobody has confirmed yet (booked, source "assistant", from today for two months), as cards for "Needs you". A Viewer is not asked (nothing is theirs to decide).
 * If they cannot be read there are no cards (the screen does not say "nothing" for something it could not read: the list of visits has them).
 */
export async function readProposals(accessToken: string, tenantId: string, now: number): Promise<NeedsCard[]> {
  const from = todayInIndia(now);
  const page = await listVisits(accessToken, tenantId, { from, to: shiftDay(from, PROPOSAL_DAYS), status: "booked" }).catch(rethrowAuth);
  if (page === null) return [];
  return page.items
    .filter((v) => v.source === "assistant")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((v): NeedsCard => ({ type: "visit", key: `visit-${v.id}`, at: v.created_at, id: v.id, visit: { who: v.who, customer: v.customer, city: v.city, startsAt: v.starts_at, partySize: v.party_size, purpose: v.purpose } }));
}

/** This week's AI figure, as a percentage only (Owner and Admin). */
export async function readWeek(accessToken: string, tenantId: string): Promise<TodayData["week"]> {
  const week = await getAiUsageWeek(accessToken, tenantId).catch(rethrowAuth);
  return week === null ? "error" : { percent: week.week_percent };
}
