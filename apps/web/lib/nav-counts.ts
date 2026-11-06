// The menu's numbers, as data: no request, no server code (the client imports this file; lib/api/nav-counts.ts asks the API).
/**
 * The numbers of the menu (job sidebar v2; C1's contract docs/contracts/nav-counts.md): `GET /v1/tenants/{id}/nav-counts`, one cheap call for the side menu, the phone bar and the More sheet, cached 30 s per workspace and role
 * by the API. EVERY number may be null: "not known or not for you", and the menu then draws no badge (0 = known, none). The minutes and the rupees are the Owner's and an Admin's only. Read-only: nothing is written or sent.
 */
export type NavCounts = {
  /** Today's `cards.waiting`: the customers' things. It does NOT hold the Lead Finder's prospects: the menu adds `prospectsNeedingOwner` itself. */
  needsYou: number | null;
  prospectsNeedingOwner: number | null;
  /** Lead Desk's own things that wait for a person (C1 #356): planned batches and tasks, callbacks due, rules and tasks paused at their cap, hot leads not reminded yet. Absent before #356: null, counted as 0. */
  leadDeskWaiting: number | null;
  newLeads: number | null;
  liveCalls: number | null;
  unreadChats: number | null;
  /** Capped at 99 by the API (the menu says "99+"). */
  followupsDue: number | null;
  visitsToday: number | null;
  quotesWaiting: number | null;
  aiTeamWorking: number | null;
  callMinutes: { used: number; total: number } | null;
  aiUsage: { usedPaise: number; allowancePaise: number; period: "month" } | null;
  plan: string | null;
  asOf: string | null;
};
export const NO_COUNTS: NavCounts = { needsYou: null, prospectsNeedingOwner: null, leadDeskWaiting: null, newLeads: null, liveCalls: null, unreadChats: null, followupsDue: null, visitsToday: null, quotesWaiting: null, aiTeamWorking: null, callMinutes: null, aiUsage: null, plan: null, asOf: null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A count, or null: a field that is missing, null or not a whole number from 0 is "not known" (one bad field never takes the others with it, as the contract says of the API's own sources). */
const count = (v: unknown, max = 1_000_000_000): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null);

/** The API's answer, field by field: whatever cannot be read is null. A body that is not an object at all is "nothing known". */
export function parseNavCounts(json: unknown): NavCounts {
  if (!isRec(json)) return NO_COUNTS;
  const m = isRec(json.call_minutes) ? json.call_minutes : null;
  const used = count(m?.used);
  const total = count(m?.total);
  const u = isRec(json.ai_usage) ? json.ai_usage : null;
  const usedPaise = count(u?.used_paise, Number.MAX_SAFE_INTEGER);
  const allowancePaise = count(u?.allowance_paise, Number.MAX_SAFE_INTEGER);
  const plan = typeof json.plan === "string" && /^[a-z0-9_]{1,40}$/.test(json.plan) ? json.plan : null;
  const asOf = typeof json.as_of === "string" && json.as_of.length <= 40 && !Number.isNaN(Date.parse(json.as_of)) ? json.as_of : null;
  return {
    needsYou: count(json.needs_you),
    prospectsNeedingOwner: count(json.prospects_needing_owner),
    leadDeskWaiting: count(json.lead_desk_waiting),
    newLeads: count(json.new_leads),
    liveCalls: count(json.live_calls),
    unreadChats: count(json.unread_chats),
    followupsDue: count(json.followups_due),
    visitsToday: count(json.visits_today),
    quotesWaiting: count(json.quotes_waiting),
    aiTeamWorking: count(json.ai_team_working),
    callMinutes: used !== null && total !== null && total > 0 ? { used, total } : null,
    aiUsage: usedPaise !== null && allowancePaise !== null && allowancePaise > 0 && u?.period === "month" ? { usedPaise, allowancePaise, period: "month" } : null,
    plan,
    asOf,
  };
}

/**
 * The number on Today in the menu, the same things Today's "Needs you" counts: the customers' things, Lead Desk's own (C1 #356: its plans, callbacks, paused rules and hot leads, which /today's `waiting` does not hold) and the Lead
 * Finder's businesses (the contract keeps the three apart so none is counted twice); null when none is known.
 */
export function todayCount(c: NavCounts): number | null {
  if (c.needsYou === null && c.prospectsNeedingOwner === null && c.leadDeskWaiting === null) return null;
  return (c.needsYou ?? 0) + (c.leadDeskWaiting ?? 0) + (c.prospectsNeedingOwner ?? 0);
}
