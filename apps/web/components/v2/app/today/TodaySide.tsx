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
  if (store.state === "error")
    return (
      <section aria-labelledby="visits-heading" data-part="visits" className={card}>
        <h2 id="visits-heading" className={SIDE_TITLE}>
          {t("today.visits.title")}
        </h2>
        <p className="text-sm text-muted">{t("frame.notyet")}</p>
      </section>
    );
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
      <Link href={to.href} className={linkClass}>
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

/**
 * "Your team" (job AU; the owner's target, 31 Oct): the title, ONE line with the helpers' names ("Lead catcher · Caller · Follow-ups"), and the link to the Office, where each helper has its own row with its state and what it did last. Agent OWL itself is the card above, so it
 * is not repeated here. `team` null (could not be read) says so.
 */
export function TeamSection({ team, deskTeam = null, base, t }: { team: readonly AgentRow[] | null; /** A Lead Desk workspace's workers, named instead of the shop's helpers (which are not its team). */ deskTeam?: readonly DeskWorker[] | null; base: string; t: T; now?: number }) {
  const helpers = team?.filter((a) => a.agent !== "main") ?? null;
  const names = deskTeam !== null ? deskTeam.map((w) => w.name) : helpers === null ? null : helpers.map((a) => t(`agent.${a.agent}`));
  return (
    <section aria-labelledby="team-heading" data-part="team" className={card}>
      <h2 id="team-heading" className={SIDE_TITLE}>
        {t("today.team")}
      </h2>
      <p data-part="team-list" data-team={deskTeam !== null ? "lead-desk" : undefined} className={SIDE_LINE}>
        {names === null || names.length === 0 ? t("frame.notyet") : names.join(" · ")}
      </p>
      <Link href={`${base}/office`} className={linkClass}>
        {t("today.team.open")}
      </Link>
    </section>
  );
}

/** "New leads" (the owner's target, 31 Oct), for a workspace that catches leads: the newest one and where it came from (the Lead catcher's own line), and the link to the Leads. Not drawn for a business type without Lead Desk. */
export function NewLeads({ deskTeam, base, t, now }: { deskTeam: readonly DeskWorker[] | null; base: string; t: T; now: number }) {
  const worker = deskTeam?.find((w) => w.key === "leads");
  if (!worker) return null;
  return (
    <section aria-labelledby="leads-heading" data-part="new-leads" className={card}>
      <h2 id="leads-heading" className={SIDE_TITLE}>
        {t("today.leads.title")}
      </h2>
      <p className={SIDE_LINE}>{deskLine(worker, t, now)}</p>
      <Link href={`${base}/leads`} className={linkClass}>
        {t("today.leads.open")}
      </Link>
    </section>
  );
}
