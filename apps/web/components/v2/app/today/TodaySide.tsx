import Link from "next/link";

import { ago, indiaClock } from "./time";
import { SIDE_CARD as card, SIDE_LINE, SIDE_LINK as linkClass, SIDE_TITLE } from "./side-card";
import type { AgentRow, DeskWorker, T, TodayData } from "./types";


/**
 * "At the store today" (job AV), from `GET /visits/today`: each visit still to come or here now, in time order, with the time, who (and how many come with them), what for, and where it stands (Confirmed,
 * Reminder sent, Waiting for the customer, or Here now). Under the list, one line about the rest of the day from the slots (the next free time, "every time is taken" or "closed today"). The links open
 * the visit calendar and the booking. `store` null = not asked: nothing is drawn; `error` = it could not be read, and the card says so.
 */
export function StoreVisits({ store, calendarHref, bookHref, t }: { store: TodayData["store"]; calendarHref: string; bookHref: string | null; t: T }) {
  if (store === null) return null;
  // a calendar that cannot be read: no card (owner's review, 5 Nov: Today never says "Not available yet")
  if (store.state === "error") return null;
  const sorted = [...store.visits].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const first = sorted[0];
  const count = sorted.length === 1 ? t("today.visits.one") : t("today.visits.other", { n: sorted.length });
  // the owner's target (31 Oct): the title, ONE line (none booked, or how many and the next one), ONE link (book when nothing is booked, else the calendar)
  const line = first ? `${count} · ${indiaClock(first.starts_at)} ${first.extra > 0 ? `${first.who} + ${first.extra}` : first.who}` : t("today.visits.none");
  const to = first || !bookHref ? { href: calendarHref, text: t("today.visits.cal") } : { href: bookHref, text: t("today.visits.book") };
  return (
    <section aria-labelledby="visits-heading" data-part="visits" className={card}>
      <h2 id="visits-heading" className={SIDE_TITLE}>
        {t("today.visits.title")}
      </h2>
      <p data-line="visits" className={SIDE_LINE}>
        {line}
      </p>
      <Link prefetch={false} href={to.href} className={linkClass}>
        {to.text}
      </Link>
    </section>
  );
}

/** One short line about a Lead Desk worker: its words (made by the server from the real state of its part), and how long ago when it has a time; a part that could not be read says so. */
function deskLine(w: DeskWorker, t: T, now: number): string {
  if (w.state === "not_available" || w.text === null) return t("frame.notyet");
  return w.at ? `${w.text} · ${ago(w.at, now)}` : w.text;
}

/** A helper as the "My AI team" strip draws it: its name, where it stands and one line of what it is doing. */
export type TeamCard = { key: string; name: string; status: "working" | "waiting" | "idle" | "off"; line: string };

const PILL: Record<TeamCard["status"], string> = { working: "bg-green-bg text-green-text", waiting: "bg-amber-bg text-amber-text", idle: "bg-surface-2 text-muted", off: "bg-surface-2 text-muted" };
const RANK: Record<TeamCard["status"], number> = { waiting: 0, working: 1, idle: 2, off: 3 };
/** How many helpers the strip shows before "+N more" (the rest are on the My AI team page). */
export const TEAM_CARDS = 4;

/**
 * The helpers of the strip, from the real state of each one: a Lead Desk workspace's own workers (their lines are made by the server), else the shop's helpers (`GET /agents/status`; one not built yet is not named). A helper that has
 * something in "Needs you" (`waitingFor`: the agents of the rows) is "Waiting for you" (unless it is switched off: "Off"); then Working, Idle. Those that wait or work come first.
 */
export function teamCards(team: readonly AgentRow[] | null, deskTeam: readonly DeskWorker[] | null, waitingFor: ReadonlySet<string>, t: T, now: number): TeamCard[] | null {
  if (deskTeam !== null) {
    // a worker whose part cannot be read is left out (Today never says "Not available yet")
    return deskTeam.filter((w) => w.state !== "not_available" && w.text !== null).map((w): TeamCard => ({ key: w.key, name: w.name, status: w.state === "working" ? "working" : w.state === "off" ? "off" : "idle", line: deskLine(w, t, now) })).sort((a, b) => RANK[a.status] - RANK[b.status]);
  }
  if (team === null) return null;
  return team
    .filter((a) => a.agent !== "main" && a.state !== "not_available")
    .map((a): TeamCard => ({
      key: a.agent,
      name: t(`agent.${a.agent}`),
      // a helper that is switched off says so, even when something of its own still waits for the person
      status: a.state === "switched_off" ? "off" : waitingFor.has(a.agent) ? "waiting" : a.state === "working" ? "working" : "idle",
      line: a.last_event ? `${a.last_event.text} · ${ago(a.last_event.at, now)}` : t(a.state === "working" ? "office.working" : a.state === "switched_off" ? "office.switchedoff" : "office.idle"),
    }))
    .sort((a, b) => RANK[a.status] - RANK[b.status]);
}

/**
 * "My AI team" (sidebar v2, owner 5 Nov), under the summary cards: one small card per helper with where it stands ("Working", "Waiting for you", "Idle", "Off") and one line of what it is doing, at most four, then "+N more" and the link
 * to the My AI team page (the Office). `team` null (could not be read) says so.
 */
export function TeamStrip({ team, deskTeam = null, waitingFor = new Set<string>(), base, t, now }: { team: readonly AgentRow[] | null; deskTeam?: readonly DeskWorker[] | null; waitingFor?: ReadonlySet<string>; base: string; t: T; now: number }) {
  const cards = teamCards(team, deskTeam, waitingFor, t, now);
  // helpers that cannot be read: no strip (owner's review, 5 Nov: Today never says "Not available yet")
  if (cards === null || cards.length === 0) return null;
  const status = (s: TeamCard["status"]) => t(s === "working" ? "office.working" : s === "waiting" ? "today.aiteam.waiting" : s === "off" ? "today.aiteam.off" : "office.idle");
  return (
    <section aria-labelledby="team-heading" data-part="team" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="team-heading" className="font-display text-xl font-semibold md:text-2xl">
          {t("today.aiteam.title")}
        </h2>
        <Link prefetch={false} href={`${base}/ai-team`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text hover:underline">
          {cards && cards.length > TEAM_CARDS ? t("today.team.more", { n: cards.length - TEAM_CARDS }) : t("today.aiteam.open")}
        </Link>
      </div>
      {cards === null || cards.length === 0 ? null : (
        <ul data-part="team-list" data-team={deskTeam !== null ? "lead-desk" : undefined} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.slice(0, TEAM_CARDS).map((c) => (
            <li key={c.key} data-helper={c.key} data-status={c.status} className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-surface px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{c.name}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[c.status]}`}>{status(c.status)}</span>
              </div>
              <p className="line-clamp-2 text-sm text-muted [overflow-wrap:anywhere]">{c.line}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "Money held" (sidebar v2, owner 5 Nov): what customers have paid on orders that are still open, and how many orders are open; the link opens the orders. Only where the API gives the numbers (the people who run the business) and there
 * is something to say (money held or an order open): a business without orders (a school) has no such card.
 */
export function MoneyHeld({ cards, base, t, money }: { cards: TodayData["cards"]; base: string; t: T; money: (paise: number) => string }) {
  if (cards.money_held_paise === null || cards.orders_open === null || (cards.money_held_paise === 0 && cards.orders_open === 0)) return null;
  return (
    <section aria-labelledby="money-heading" data-part="money" className={card}>
      <h2 id="money-heading" className={SIDE_TITLE}>
        {t("today.money.title")}
      </h2>
      <p className="font-display text-2xl font-semibold tabular-nums">{money(cards.money_held_paise)}</p>
      <p className={SIDE_LINE}>{t(cards.orders_open === 1 ? "today.money.one" : "today.money.other", { n: cards.orders_open })}</p>
      <Link prefetch={false} href={`${base}/orders`} className={linkClass}>
        {t("today.money.open")}
      </Link>
    </section>
  );
}

/** "New leads" (the owner's target, 31 Oct), for a workspace that catches leads: the newest one and where it came from (the Lead catcher's own line), and the link to the Leads. Not drawn for a business type without Lead Desk. */
export function NewLeads({ deskTeam, count = null, base, t, now }: { deskTeam: readonly DeskWorker[] | null; /** Leads not opened yet in the last 7 days (C1's nav-counts); null = not known. */ count?: number | null; base: string; t: T; now: number }) {
  const worker = deskTeam?.find((w) => w.key === "leads" && w.state !== "not_available" && w.text !== null);
  // every business that gets leads has the card (owner's review, 5 Nov), from the count when there is no Lead Desk; nothing known: no card
  if (!worker && count === null) return null;
  return (
    <section aria-labelledby="leads-heading" data-part="new-leads" className={card}>
      <h2 id="leads-heading" className={SIDE_TITLE}>
        {t("today.leads.title")}
      </h2>
      {count !== null ? <p className="font-display text-3xl font-semibold tabular-nums">{count}</p> : null}
      <p className={SIDE_LINE}>{worker ? deskLine(worker, t, now) : t(count === 0 ? "today.leads.count.none" : "today.leads.count", { n: count ?? 0 })}</p>
      {/* the Leads row's own page: Lead Desk where it is on, else the review list (there is no page at /leads) */}
      <Link prefetch={false} href={deskTeam !== null ? `${base}/lead-desk` : `${base}/review`} className={linkClass}>
        {t("today.leads.open")}
      </Link>
    </section>
  );
}
