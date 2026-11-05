import { todayCount, type NavCounts } from "@/lib/nav-counts";

import type { CountKey } from "./nav";

/**
 * What a menu row shows beside its word (sidebar v2; C1's nav-counts): Today the number that waits (the customers' things plus the Lead Finder's businesses; before the counts arrive, the frame's own Today count), Leads "12 new",
 * Calls "● 1 live", Chats "2", Follow-ups "5 due" ("99+ due": the API caps it), Visits "2 today", Quotes "1", My AI team "4 working". A number that is null ("not known or not for you") or 0 draws nothing: the menu never shows a made-up
 * or an empty badge. `say` fills a word of the menu ("{n} new").
 */
export type Badge = { text: string; tone: "brand" | "green" | "quiet" };
type Say = (key: string, fallback: string, vars: Record<string, string | number>) => string;

const shown = (n: number | null): n is number => n !== null && n > 0;

export function badgeOf(key: CountKey | undefined, counts: NavCounts, waiting: number | null, say: Say): Badge | null {
  switch (key) {
    case "today": {
      const n = todayCount(counts) ?? waiting;
      return shown(n) ? { text: String(n), tone: "brand" } : null;
    }
    case "leads":
      return shown(counts.newLeads) ? { text: say("nav.count.new", "{n} new", { n: counts.newLeads }), tone: "quiet" } : null;
    case "calls":
      return shown(counts.liveCalls) ? { text: say("nav.count.live", "{n} live", { n: counts.liveCalls }), tone: "green" } : null;
    case "chats":
      return shown(counts.unreadChats) ? { text: String(counts.unreadChats), tone: "quiet" } : null;
    case "followups":
      return shown(counts.followupsDue) ? { text: say("nav.count.due", "{n} due", { n: counts.followupsDue >= 99 ? "99+" : counts.followupsDue }), tone: "quiet" } : null;
    case "visits":
      return shown(counts.visitsToday) ? { text: say("nav.count.today", "{n} today", { n: counts.visitsToday }), tone: "quiet" } : null;
    case "quotes":
      return shown(counts.quotesWaiting) ? { text: String(counts.quotesWaiting), tone: "quiet" } : null;
    case "aiteam":
      return shown(counts.aiTeamWorking) ? { text: say("nav.count.working", "{n} working", { n: counts.aiTeamWorking }), tone: "green" } : null;
    default:
      return null;
  }
}

/** The bare number for a phone tab's round badge (the bar has no room for words): the same rules, the number only. */
export function barNumber(key: CountKey | undefined, counts: NavCounts, waiting: number | null): number | null {
  const n = key === "today" ? (todayCount(counts) ?? waiting) : key === "leads" ? counts.newLeads : key === "chats" ? counts.unreadChats : key === "calls" ? counts.liveCalls : null;
  return shown(n) ? n : null;
}

/** "412 / 600" and the share used (0 to 100) of a meter; null when the API did not give it (another role, or not known). */
export function meterOf(m: { used: number; total: number } | null): { text: string; percent: number } | null {
  if (!m || m.total <= 0) return null;
  return { text: `${m.used.toLocaleString("en-IN")} / ${m.total.toLocaleString("en-IN")}`, percent: Math.min(100, Math.round((m.used / m.total) * 100)) };
}
/** Rupees, whole, Indian grouping ("₹68 / ₹300"). */
export function rupeeMeter(u: { usedPaise: number; allowancePaise: number } | null): { text: string; percent: number } | null {
  if (!u || u.allowancePaise <= 0) return null;
  const r = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
  return { text: `${r(u.usedPaise)} / ${r(u.allowancePaise)}`, percent: Math.min(100, Math.round((u.usedPaise / u.allowancePaise) * 100)) };
}
