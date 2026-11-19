import { getTodayBriefing, type TodayBriefing } from "@/lib/api/today-briefing";

/** C1's small `/today/briefing` read, started by the page at its very top and handed to TodayScreen as a promise (one request; a failure is "not told", null). */
export function startBriefing(token: string, tenantId: string): Promise<TodayBriefing | null> {
  return getTodayBriefing(token, tenantId).catch(() => null);
}
