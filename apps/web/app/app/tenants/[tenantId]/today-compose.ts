import type { NeedsCard, Role, T, TodayData } from "@/components/v2/app/today/types";
import { todayInIndia } from "@/components/v2/app/visits/dates";
import { withFinder } from "@/lib/lead-finder/types";
import { todayCount, type NavCounts } from "@/lib/nav-counts";
import { upgradeHref } from "@/lib/plan/tier-source";

import { finderUpsellCard } from "./lead-finder-today";
import type { LeadDeskToday } from "./lead-desk-today";
import { mergeDesk, overdueFirst } from "./today-data";

/** What the Lead Finder's own answer says about this workspace: the frame's one read ("on", "upsell" on a plan without it, "hidden"). */
export type FinderState = "on" | "upsell" | "hidden";

/**
 * What the page makes of Today's own data (`readToday`) once the reads that add to it have answered: Lead Desk's items and workers, the Lead Finder's businesses, the menu's numbers, the Lead Finder's name in "Your team" and the plan's one upsell row.
 * ONE function for the page that waits for everything (the older looks) and for the page that draws in parts (design system v6), so the two cannot disagree about what "Needs you" holds or in which order. Pure.
 *
 * `campus`: the business type's own card counts its visits (a school's "Campus visits today"), so the shop's "At the store today" is left out (owner, 4 Nov: no shop words for a school).
 */
export function composeToday(raw: TodayData, o: { desk: LeadDeskToday; finder: readonly NeedsCard[]; deskPack: boolean; counts: NavCounts | null; campus: boolean; finderState: FinderState; role: Role; base: string; tt: T; now: number }): { data: TodayData; newLeads: number | null } {
  const newLeads = o.counts?.newLeads ?? null;
  // Lead Desk's items and workers join what the API said (the merge keeps one card per thing and counts only what the API did not)
  let data = mergeDesk(raw, { needs: [...o.desk.needs, ...o.finder], team: o.deskPack ? o.desk.team : [] });
  data = overdueFirst(data, todayInIndia(o.now));
  // the number in the menu IS the number on "Needs you" (owner, 17 Nov): both are C1's one count, one function for the two
  const menuCount = o.counts ? todayCount(o.counts) : null;
  if (menuCount !== null) data = { ...data, cards: { ...data.cards, waiting: menuCount } };
  if (o.campus) data = { ...data, store: null };
  // the Lead Finder is named in "Your team" exactly where its own API says it is available and the plan has it (C1, 4 Nov): the helpers' status may still say "not built" for it
  data = { ...data, team: withFinder(data.team, o.finderState === "on") };
  // a Lead Desk plan (owner decision 4 Nov): one short "part of AI Workforce" row instead of the Lead Finder's rows, at the end and not counted as waiting
  const upsell = o.finderState === "upsell" && data.needs !== null ? finderUpsellCard(o.role, upgradeHref(o.base, o.role), o.tt, new Date(o.now).toISOString()) : null;
  if (upsell && data.needs) data = { ...data, needs: [...data.needs, upsell] };
  return { data, newLeads };
}
