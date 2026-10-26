import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AgentMark } from "../mark/AgentMark";
import { StateDot } from "../mark/StateDot";
import { ago, indiaClock } from "./time";
import type { AgentRow, StoreVisit, T, TodayData } from "./types";

const card = "flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-5";
const STATUS_TONE: Record<StoreVisit["status"], string> = { confirmed: "bg-green-bg text-green-text", reminder_sent: "bg-surface-2 text-muted", requested: "bg-amber-bg text-amber-text" };
const STATUS_WORD: Record<StoreVisit["status"], string> = { confirmed: "today.visits.confirmed", reminder_sent: "today.visits.reminder", requested: "today.visits.requested" };
const linkClass = "inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline";

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
        <h2 id="visits-heading" className="font-display text-xl font-semibold">
          {t("today.visits.title")}
        </h2>
        <p className="text-sm text-muted">{t("frame.notyet")}</p>
      </section>
    );
  const sorted = [...store.visits].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const line = store.slots === "free" && store.nextFree ? t("today.visits.open", { time: indiaClock(store.nextFree) }) : store.slots === "full" ? t("today.visits.full") : store.slots === "closed" ? t("today.visits.closed") : null;
  return (
    <section aria-labelledby="visits-heading" data-part="visits" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="visits-heading" className="font-display text-xl font-semibold">
          {t("today.visits.title")}
        </h2>
        <span className="text-sm text-muted">{sorted.length === 0 ? t("today.visits.zero") : sorted.length === 1 ? t("today.visits.one") : t("today.visits.other", { n: sorted.length })}</span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-base text-muted">{t("today.visits.none")}</p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {sorted.map((v) => (
            <li key={v.id} className="flex gap-3.5">
              <span className="w-14 flex-none font-bold tabular-nums">{indiaClock(v.starts_at)}</span>
              <div className="min-w-0 flex-1 border-b border-line pb-3.5 last:border-b-0 last:pb-0">
                <p className="font-semibold [overflow-wrap:anywhere]">{v.extra > 0 ? `${v.who} + ${v.extra}` : v.who}</p>
                {v.topic ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{v.topic}</p> : null}
                <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${v.here ? "bg-brand-bg text-brand-text" : STATUS_TONE[v.status]}`}>{v.here ? t("today.visits.here") : t(STATUS_WORD[v.status])}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {line ? (
        <p data-line="slots" className="rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm font-medium">
          {line}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Link href={calendarHref} className={linkClass}>
          {t("today.visits.cal")}
        </Link>
        {bookHref ? (
          <Link href={bookHref} className={linkClass}>
            {t("today.visits.book")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** One short line about a helper: its state, or the last thing it did and how long ago. */
function statusLine(a: AgentRow, t: T, now: number): string {
  if (a.state === "switched_off") return t("office.switchedoff");
  if (a.state === "not_available") return t("frame.notyet");
  if (a.state === "working") return t("office.working");
  return a.last_event ? `${a.last_event.text} · ${ago(a.last_event.at, now)}` : t("office.idle");
}

/**
 * "Your team" (job AU): the six helpers, each a row (job DQ part 0: they were three narrow columns whose status lines were cut off and overlapped at both desktop and phone widths): the picture, a dot for its state, the name and ONE live status line, in full, wrapping, from the helpers' status (`GET /agents/status`): working, switched off, not
 * available, or the last thing the helper did and how long ago. Agent OWL itself is the card above, so it is not repeated here. `team` null (could not be read) says so; the link opens the Office.
 */
export function TeamSection({ team, base, t, now }: { team: readonly AgentRow[] | null; base: string; t: T; now: number }) {
  const helpers = team?.filter((a) => a.agent !== "main") ?? null;
  return (
    <section aria-labelledby="team-heading" data-part="team" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="team-heading" className="font-display text-xl font-semibold">
          {t("today.team")}
        </h2>
        <Link href={`${base}/office`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-text hover:underline">
          {t("today.team.open")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {helpers === null ? (
        <p className="text-sm text-muted">{t("frame.notyet")}</p>
      ) : helpers.length === 0 ? (
        <p className="text-sm text-muted">{t("frame.notyet")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line" data-part="team-list">
          {helpers.map((a) => (
            <li key={a.agent} className="flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <AgentMark agent={a.agent} px={40} off={a.state !== "working" && a.state !== "idle"} mood={a.state === "working" ? "thinking" : a.state === "idle" ? "idle" : "resting"} className="size-10 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span data-part="team-name" className="inline-flex min-w-0 items-center gap-1.5 text-base font-semibold leading-tight">
                  <StateDot state={a.state === "working" ? "working" : a.state === "idle" ? "idle" : "off"} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{t(`agent.${a.agent}`)}</span>
                </span>
                <span data-part="team-status" className={`text-sm leading-snug [overflow-wrap:anywhere] ${a.state === "working" ? "font-semibold text-brand-text" : "text-muted"}`}>{statusLine(a, t, now)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
