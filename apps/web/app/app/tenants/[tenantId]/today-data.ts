import { readMyProfileCached } from "../../me-read";
import type { ClassicKind, NeedsCard, NeedsYouItem, RecentItem, Role, TodayData } from "@/components/v2/app/today/types";
import { NOTHING_TODAY, weightOf } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { getCallBrief, type CallBrief } from "@/lib/api/calls";
import { summaryBrief } from "@/lib/api/today-summary";
import { listCallRequests, listOutboxApprovals, type CallRequest, type OutboxMessage } from "@/lib/api/outbox";
import { fetchMembers } from "@/lib/api/orders";
import { listPriceAsks } from "@/lib/api/price-asks";
import type { NeedsYouItem as ApiItem } from "@/lib/api/today";

import { readBalance } from "@/lib/balance/source";
import { readDigest } from "./outbox-digest";
import { readProposals, readSending, readStore, readWeek } from "./today-visits";
import { targetPaths } from "./target-path";
import { readAgentsCached, readTodayCached } from "./today-read";
import { indiaClock, indiaDay } from "@/components/v2/app/today/time";
import type { LeadDeskToday } from "./lead-desk-today";

const CLASSIC: readonly string[] = ["quote_approval", "followup_due", "order_money_held", "material_quote_approval", "campaign_approval", "fees_overdue", "voice_credits", "credits_low", "enquired_again", "crm_push_failing", "line_renewal", "unknown_item"];
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
/** "₹1,050 left · about 233 call minutes · Top up": the amount first, the minutes when the API gave them. No "credits", no supplier. */
export function balanceLine(b: { text: string; minutesEstimate: number | null }): string {
  return [`${b.text} left`, b.minutesEstimate !== null ? `about ${b.minutesEstimate} call minutes` : null, "Top up"].filter((x) => x !== null).join(" · ");
}

export async function readToday(accessToken: string, tenantId: string, role: Role, now: () => number = Date.now, pre: { /** The agents' status, when the page has already started that read (the band needs it too: one read, not two). */ agents?: Promise<Awaited<ReturnType<typeof readAgentsCached>>> } = {}): Promise<TodayData> {
  const digest = role === "viewer" ? null : readDigest(accessToken, tenantId, now); // a Viewer may not read the outbox: nothing to ask
  const [today, team, store, proposals, week, sending, asks] = await Promise.allSettled([
    readTodayCached(accessToken, tenantId),
    pre.agents ?? readAgentsCached(accessToken, tenantId),
    readStore(accessToken, tenantId, now()),
    role === "viewer" ? Promise.resolve([] as NeedsCard[]) : readProposals(accessToken, tenantId, now()),
    role === "owner" || role === "admin" ? readWeek(accessToken, tenantId) : Promise.resolve(null),
    role === "owner" || role === "admin" ? readSending(accessToken, tenantId) : Promise.resolve(null),
    role === "viewer" ? Promise.resolve([]) : listPriceAsks(accessToken, tenantId), // what the shop told customers it would come back to (Owner, Admin, Sales)
  ]);
  for (const r of [today, team, store, proposals, week, sending, asks]) if (r.status === "rejected" && r.reason instanceof ApiAuthError) throw r.reason;

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
    // a caller who asked for a person: the call says which lead to call back from (at most ten are read; one that cannot be read keeps its card, without Call back)
    const asked = t.needs_you.filter((i) => i.kind === "person_requested" || i.kind === "visit_requested").slice(0, 10);
    // the balance row says the amount (owner, 14 Nov: "₹1,050 left · about 233 call minutes · Top up", not only "balance is low"); where the balance cannot be read the API-side sentence stays
    const wantsBalance = t.needs_you.some((i) => i.kind === "voice_credits" || i.kind === "credits_low");
    const balance = wantsBalance ? await readBalance(accessToken, tenantId).catch(() => null) : null;
    const [where, messages, calls, briefs] = await Promise.all([
      targetPaths(accessToken, tenantId, [...t.needs_you.filter((i) => isClassic(i) && !i.noTarget).map((i) => i.target), ...t.recent.map((r) => r.target)]),
      wantsMessages ? listOutboxApprovals(accessToken, tenantId, { limit: 100 }).then((p) => new Map<string, OutboxMessage>(p.items.map((m) => [m.id, m]))).catch(rethrowAuth) : Promise.resolve(null),
      wantsCalls ? listCallRequests(accessToken, tenantId, { status: "requested", limit: 100 }).then((p) => new Map<string, CallRequest>(p.items.map((c) => [c.id, c]))).catch(rethrowAuth) : Promise.resolve(null),
      Promise.all(asked.map((i) => briefOf(accessToken, tenantId, i.target.id).then((b): [string, CallBrief] => [i.id, b]).catch(rethrowAuth))).then((all) => new Map(all.filter((x): x is [string, CallBrief] => x !== null))),
    ]);
    data.cards = { waiting: Math.max(0, t.cards.waiting - (t.skipped ?? 0)), money_held_paise: t.cards.money_held_paise, orders_open: t.cards.orders_open };
    data.needs = t.needs_you.map((i): NeedsCard => {
      const key = `${i.kind}-${i.id}`;
      if (isClassic(i)) return { type: "item", key, at: i.at, item: { ...i, ...((i.kind === "voice_credits" || i.kind === "credits_low") && balance ? { summary: balanceLine(balance) } : {}), href: i.noTarget ? "" : i.kind === "enquired_again" ? `/app/tenants/${tenantId}/chats/${i.target.id}` : where(i.target) } satisfies NeedsYouItem };
      const customer = i.customer === "" ? null : i.customer;
      if (i.kind === "outbox_approval") {
        const m = messages?.get(i.id);
        return { type: "outbox", key, at: i.at, id: i.id, customer, city: i.city, message: m ? { text: m.text, language: m.language, category: m.category, flags: m.flags, reasonText: m.reason_text, gloss: m.gloss_en, media: m.media.map((x) => ({ position: x.position, thumb_url: x.thumb_url })) } : null };
      }
      if (i.kind === "person_requested" || i.kind === "visit_requested") {
        const b = briefs.get(i.id);
        const visitAt = i.kind === "visit_requested" ? (b?.visitAt ?? null) : null;
        return { type: "person", key, at: i.at, id: i.target.id, customer, city: i.city, leadHref: b?.leadId ? `/app/tenants/${tenantId}/leads/${b.leadId}` : null, gist: b?.gist ?? null, visitAt, bookHref: i.kind === "visit_requested" ? bookHref(tenantId, visitAt, b?.leadId ?? null) : null };
      }
      const c = calls?.get(i.id);
      return { type: "call", key, at: i.at, id: i.id, customer, city: i.city, request: c ? { reason: c.reason, language: c.language } : null };
    });
    data.recent = t.recent.map((r): RecentItem => ({ ...r, href: where(r.target) }));
    // the visits Agent OWL proposed wait for a person as well: they follow the API's own items. The API's `waiting` already counts them (job AY), so nothing is added to it here: the badge is the API's number.
    if (proposals.status === "fulfilled" && proposals.value.length > 0) data.needs = [...(data.needs ?? []), ...proposals.value];
    // price questions and promises ("Price asked: X", "Promised: X"): the API sends them earliest deadline first, and they follow the API's own items in that order. A read that failed is no rows (the rest of Today is untouched).
    if (asks.status === "fulfilled" && asks.value.length > 0) {
      const cards = asks.value.map((a): NeedsCard => ({ type: "promise", key: `price-ask-${a.id}`, at: a.askedAt, id: a.id, kind: a.kind, item: a.item, customer: a.customer, neededBy: a.neededBy, chatHref: a.leadId ? `/app/tenants/${tenantId}/chats/${a.leadId}` : null }));
      data.needs = [...(data.needs ?? []), ...cards];
    }
  }
  return data;
}

/**
 * Overdue things first (owner, 17 Nov): a promise or a price question whose day has PASSED ("Overdue · 6 Nov") goes to the top of Needs you, the oldest deadline first; everything else keeps its order. Pure; `today` is the India day.
 */
export function overdueFirst(data: TodayData, today: string): TodayData {
  if (data.needs === null) return data;
  const over = (c: NeedsCard): string | null => (c.type === "promise" && c.neededBy !== null && c.neededBy < today ? c.neededBy : null);
  const late = data.needs.filter((c) => over(c) !== null).sort((a, b) => (over(a) as string).localeCompare(over(b) as string));
  if (late.length === 0) return data;
  return { ...data, needs: [...late, ...data.needs.filter((c) => over(c) === null)] };
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
  // newest first, but the Lead Finder's new businesses after the customers' things (owner, 5 Nov: a fresh search buried two quotes and two follow-ups under its prospects)
  const later = (c: NeedsCard) => (c.type === "item" && c.item.kind === "prospect_waiting" ? 1 : 0);
  data.needs = [...merged, ...added].sort((a, b) => later(a) - later(b) || Date.parse(b.at) - Date.parse(a.at));
  // the count is of THINGS, not rows: the "11 more prospects" row adds 11 (it said 10 for 4 + 5 + 11 = 20)
  data.cards = { ...data.cards, waiting: (data.cards.waiting ?? 0) + added.reduce((n, c) => n + weightOf(c), 0) };
  return data;
}

/** The brief of one call: from the Today summary when it holds it (TODAY_SUMMARY_SCREENS), else `GET /calls/{id}`. A call the summary read nothing for has no brief (the card keeps no "Call back"), as when its own read failed. */
async function briefOf(accessToken: string, tenantId: string, callId: string): Promise<CallBrief> {
  const held = await summaryBrief(tenantId, callId);
  if (held === undefined) return getCallBrief(accessToken, tenantId, callId);
  if (held === null) throw new Error("no brief");
  return held;
}

/** "Book" on a caller's visit: Visits on that India day with the time and the lead filled in (the page reads ?date, ?time and ?lead); without a time, Visits on today. */
function bookHref(tenantId: string, visitAt: string | null, leadId: string | null): string {
  const q = new URLSearchParams();
  if (visitAt) {
    q.set("date", indiaDay(visitAt));
    q.set("time", indiaClock(visitAt).padStart(5, "0"));
  }
  if (leadId) q.set("lead", leadId);
  const s = q.toString();
  return `/app/tenants/${tenantId}/visits${s ? `?${s}` : ""}`;
}

/** Keeps a read that failed from taking the others with it, except a rejected session (which sends the person to sign in). */
function rethrowAuth(error: unknown): null {
  if (error instanceof ApiAuthError) throw error;
  return null;
}

/** The first word of a full name ("Ada Test Lovelace" -> "Ada"); "" when there is none. */
export const firstName = (full: string | null | undefined): string => (full ?? "").trim().split(/\s+/)[0] ?? "";

/** The name for the greeting: what the person asked to be called (My profile, "How should I address you?"), else their name there (`GET /me/profile`), else the one the members list has for them (it is null for most). Never throws except for a rejected session. */
export async function readDisplayName(accessToken: string, tenantId: string, userId: string): Promise<string | null> {
  try {
    const mine = await readMyProfileCached(accessToken, tenantId);
    // what the person asked to be called is used as typed; their full name is cut to the first name ("Good afternoon, Gowtham", not the whole name)
    const own = mine.addressAs?.trim() || firstName(mine.displayName);
    if (own) return own;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    // (a profile that cannot be read: the members list may still know the name)
  }
  try {
    return firstName((await fetchMembers(accessToken, tenantId)).find((m) => m.user_id === userId)?.display_name) || null;
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
