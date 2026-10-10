import { NOTHING_TODAY, type NeedsYouItem, type RecentItem, type TodayData } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { fetchMembers } from "@/lib/api/orders";
import { getAgentsStatus } from "@/lib/api/today";

import { targetPaths } from "./target-path";
import { readTodayCached } from "./today-read";

/**
 * What the Today screen shows, from `getToday()` and `getAgentsStatus()` of lib/api (Job AD). Each is read on its own: one that fails is null (the screen says "Not available yet" in that
 * place only); a rejected session still sends the person to sign in (ApiAuthError is rethrown for the caller). What the person sees is decided by the database for their role (a Viewer gets
 * zeros, Sales get no approvals): the screen draws what it is given.
 *
 * "Open" goes to the page that decides, from the item's `target`: an order, a lead (its follow-ups), an enquiry. A quote has no page of its own: it opens the enquiry it belongs to, found
 * from the newest 50 quotes (`fetchQuotes`) or, for an older one, from the quote itself; if neither can be read it opens the list of quotes.
 */
export async function readToday(accessToken: string, tenantId: string): Promise<TodayData> {
  const [today, team] = await Promise.allSettled([readTodayCached(accessToken, tenantId), getAgentsStatus(accessToken, tenantId)]);
  for (const r of [today, team]) if (r.status === "rejected" && r.reason instanceof ApiAuthError) throw r.reason;

  const data: TodayData = { ...NOTHING_TODAY, cards: { ...NOTHING_TODAY.cards } };
  if (team.status === "fulfilled") data.team = team.value;
  if (today.status === "fulfilled") {
    const t = today.value;
    const where = await targetPaths(accessToken, tenantId, [...t.needs_you.map((i) => i.target), ...t.recent.map((r) => r.target)]);
    data.cards = { waiting: t.cards.waiting, money_held_paise: t.cards.money_held_paise, orders_open: t.cards.orders_open };
    data.needs_you = t.needs_you.map((i): NeedsYouItem => ({ ...i, href: where(i.target) }));
    data.recent = t.recent.map((r): RecentItem => ({ ...r, href: where(r.target) }));
  }
  return data;
}

/** The person's display name in this workspace, if the members list has one for them (it is null for most). Never throws except for a rejected session. */
export async function readDisplayName(accessToken: string, tenantId: string, userId: string): Promise<string | null> {
  try {
    return (await fetchMembers(accessToken, tenantId)).find((m) => m.user_id === userId)?.display_name ?? null;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
