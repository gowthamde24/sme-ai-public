import { readMyProfileCached } from "../../me-read";
import type { ClassicKind, NeedsCard, NeedsYouItem, RecentItem, Role, TodayData } from "@/components/v2/app/today/types";
import { NOTHING_TODAY } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { listCallRequests, listOutboxApprovals, type CallRequest, type OutboxMessage } from "@/lib/api/outbox";
import { fetchMembers } from "@/lib/api/orders";
import type { NeedsYouItem as ApiItem } from "@/lib/api/today";

import { readDigest } from "./outbox-digest";
import { readProposals, readSending, readStore, readWeek } from "./today-visits";
import { targetPaths } from "./target-path";
import { readAgentsCached, readTodayCached } from "./today-read";
import type { LeadDeskToday } from "./lead-desk-today";

const CLASSIC: readonly string[] = ["quote_approval", "followup_due", "order_money_held"];
const isClassic = (i: ApiItem): i is ApiItem & { kind: ClassicKind } => CLASSIC.includes(i.kind);

/**
 * What the Today screen shows, from `getToday()`, `getAgentsStatus()` and, for what is held for the person, the outbox (job AU). Each is read on its own: one that fails is null (the screen says
 * "Not available yet" in that place only); a rejected session still sends the person to sign in (ApiAuthError is rethrown for the caller). What the person sees is decided by the database for
 * their role (a Viewer gets zeros, Sales get no approvals, an Admin gets messages but not calls): the screen draws what it is given.
 *
 * "Open" goes to the page that decides, from the item's `target`: an order, a lead (its follow-ups), an enquiry. A quote has no page of its own: it opens the enquiry it belongs to, found
 * from the newest 50 quotes (`fetchQuotes`) or, for an older one, from the quote itself; if neither can be read it opens the list of quotes. A WhatsApp message held for approval and a call request
 * are decided on Today itself: their words (`GET /outbox/approvals`, Owner and Admin) and reason (`GET /call-requests`) are read here and put on the card; if they cannot be read the card says so
 * and offers no button, because nobody should approve words they cannot read. The last 24 hours of the outbox are one promise that never rejects (`readDigest`), read under a Suspense each.
 * "At the store today" is `GET /visits/today` (any member), the usage card's weekly figure is `GET /ai-usage/week` (Owner and Admin) and a visit Agent OWL proposed is a card of its own (job AV).
 */
export async function readToday(accessToken: string, tenantId: string, role: Role, now: () => number = Date.now): Promise<TodayData> {
  const digest = role === "viewer" ? null : readDigest(accessToken, tenantId, now); // a Viewer may not read the outbox: nothing to ask
  const [today, team, store, proposals, week, sending] = await Promise.allSettled([
    readTodayCached(accessToken, tenantId),
    readAgentsCached(accessToken, tenantId),
    readStore(accessToken, tenantId, now()),
    role === "viewer" ? Promise.resolve([] as NeedsCard[]) : readProposals(accessToken, tenantId, now()),
    role === "owner" || role === "admin" ? readWeek(accessToken, tenantId) : Promise.resolve(null),
    role === "owner" || role === "admin" ? readSending(accessToken, tenantId) : Promise.resolve(null),
  ]);
  for (const r of [today, team, store, proposals, week, sending]) if (r.status === "rejected" && r.reason instanceof ApiAuthError) throw r.reason;

  const data: TodayData = { ...NOTHING_TODAY, cards: { ...NOTHING_TODAY.cards }, digest };
  if (team.status === "fulfilled") data.team = team.value;
  data.store = store.status === "fulfilled" ? store.value : { state: "error" };
  if (week.status === "fulfilled") data.week = week.value;
  else if (role === "owner" || role === "admin") data.week = "error";
  if (sending.status === "fulfilled") data.sending = sending.value;
  if (today.status === "fulfilled") {
    const t = today.value;
    const wantsMessages = t.needs_you.some((i) => i.kind === "outbox_approval");
    const wantsCalls = t.needs_you.some((i) => i.kind === "call_approval");
    const [where, messages, calls] = await Promise.all([
      targetPaths(accessToken, tenantId, [...t.needs_you.filter(isClassic).map((i) => i.target), ...t.recent.map((r) => r.target)]),
      wantsMessages ? listOutboxApprovals(accessToken, tenantId, { limit: 100 }).then((p) => new Map<string, OutboxMessage>(p.items.map((m) => [m.id, m]))).catch(rethrowAuth) : Promise.resolve(null),
      wantsCalls ? listCallRequests(accessToken, tenantId, { status: "requested", limit: 100 }).then((p) => new Map<string, CallRequest>(p.items.map((c) => [c.id, c]))).catch(rethrowAuth) : Promise.resolve(null),
    ]);
    data.cards = { waiting: Math.max(0, t.cards.waiting - (t.skipped ?? 0)), money_held_paise: t.cards.money_held_paise, orders_open: t.cards.orders_open };
    data.needs = t.needs_you.map((i): NeedsCard => {
      const key = `${i.kind}-${i.id}`;
      if (isClassic(i)) return { type: "item", key, at: i.at, item: { ...i, href: where(i.target) } satisfies NeedsYouItem };
      const customer = i.customer === "" ? null : i.customer;
      if (i.kind === "outbox_approval") {
        const m = messages?.get(i.id);
        return { type: "outbox", key, at: i.at, id: i.id, customer, city: i.city, message: m ? { text: m.text, language: m.language, category: m.category, flags: m.flags, reasonText: m.reason_text, gloss: m.gloss_en, media: m.media.map((x) => ({ position: x.position, thumb_url: x.thumb_url })) } : null };
      }
      const c = calls?.get(i.id);
      return { type: "call", key, at: i.at, id: i.id, customer, city: i.city, request: c ? { reason: c.reason, language: c.language } : null };
    });
    data.recent = t.recent.map((r): RecentItem => ({ ...r, href: where(r.target) }));
    // the visits Agent OWL proposed wait for a person as well: they follow the API's own items. The API's `waiting` already counts them (job AY), so nothing is added to it here: the badge is the API's number.
    if (proposals.status === "fulfilled" && proposals.value.length > 0) data.needs = [...(data.needs ?? []), ...proposals.value];
  }
  return data;
}

/**
 * Lead Desk's items (`lead-desk-today.ts`) join the API's. One the API listed too (a hot lead, a plan paused by a limit: the same `kind-id` key) is one card: it keeps the words and address Lead Desk made and the time the API gave; one only Lead
 * Desk knows is new and adds to the count (the API's `waiting` does not hold it). The cards are then newest first, so a hot lead is not buried under older things. The count is what the person is told: "All clear" is for 0 and only 0.
 */
export function mergeDesk(base: TodayData, desk: LeadDeskToday): TodayData {
  const data: TodayData = { ...base, cards: { ...base.cards }, deskTeam: desk.team.length > 0 ? desk.team : null };
  if (desk.needs.length === 0 || data.needs === null) return data;
  const own = new Map(desk.needs.map((c) => [c.key, c]));
  const merged = data.needs.map((c) => {
    const mine = own.get(c.key);
    return mine && mine.type === "item" ? ({ ...mine, at: c.at, item: { ...mine.item, at: c.at } } satisfies NeedsCard) : c;
  });
  const have = new Set(data.needs.map((c) => c.key));
  const added = desk.needs.filter((c) => !have.has(c.key));
  data.needs = [...merged, ...added].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  data.cards = { ...data.cards, waiting: (data.cards.waiting ?? 0) + added.length };
  return data;
}

/** Keeps a read that failed from taking the others with it, except a rejected session (which sends the person to sign in). */
function rethrowAuth(error: unknown): null {
  if (error instanceof ApiAuthError) throw error;
  return null;
}

/** The name for the greeting: what the person asked to be called (My profile, "How should I address you?"), else their name there (`GET /me/profile`), else the one the members list has for them (it is null for most). Never throws except for a rejected session. */
export async function readDisplayName(accessToken: string, tenantId: string, userId: string): Promise<string | null> {
  try {
    const mine = await readMyProfileCached(accessToken, tenantId);
    const own = mine.addressAs?.trim() || mine.displayName?.trim();
    if (own) return own;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    // (a profile that cannot be read: the members list may still know the name)
  }
  try {
    return (await fetchMembers(accessToken, tenantId)).find((m) => m.user_id === userId)?.display_name ?? null;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
