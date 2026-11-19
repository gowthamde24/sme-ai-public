import { ApiAuthError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * C1's `GET /v1/tenants/{t}/today/briefing` (docs/contracts/today-briefing.md, 19 Nov 2026): the numbers of Today's briefing line in one answer of about 150 bytes (kept 5 s per person, dropped when they write),
 * so the page can paint the line before the big reads arrive. Each number is an integer by the caller's role, or null = not known or not for you (0 = known and zero).
 */
export type TodayBriefing = { needsYou: number | null; newLeads: number | null; visitsToday: number | null; unreadChats: number | null; followupsDue: number | null; quotesWaiting: number | null; liveCalls: number | null };

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000 ? v : null);

export function parseTodayBriefing(json: unknown): TodayBriefing | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const x = json as Record<string, unknown>;
  return { needsYou: count(x.needs_you), newLeads: count(x.new_leads), visitsToday: count(x.visits_today), unreadChats: count(x.unread_chats), followupsDue: count(x.followups_due), quotesWaiting: count(x.quotes_waiting), liveCalls: count(x.live_calls) };
}

/** null when it cannot be told (an API without the route: 404, or any failure): the page then waits for the big reads as before. A rejected session is still said (the caller sends the person to sign in). */
export async function getTodayBriefing(token: string, tenantId: string): Promise<TodayBriefing | null> {
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    return parseTodayBriefing(await apiRequest(`/v1/tenants/${tenantId}/today/briefing`, token));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
