import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { OwlSvg } from "../owl/OwlSvg";
import { ago, indiaClock } from "./time";
import type { AgentRow, StoreVisit, T } from "./types";

const card = "flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-5";
const STATUS_TONE: Record<StoreVisit["status"], string> = { confirmed: "bg-green-bg text-green-text", reminder_sent: "bg-surface-2 text-muted", requested: "bg-amber-bg text-amber-text" };
const STATUS_WORD: Record<StoreVisit["status"], string> = { confirmed: "today.visits.confirmed", reminder_sent: "today.visits.reminder", requested: "today.visits.requested" };

/**
 * "At the store today" (job AU). Store visits are not in the API yet (job AS), so the section is built behind the data: with no visits (null or an empty list) it is not drawn at all. The fields it needs
 * are `StoreVisit` in ./types.ts. `calendarHref` is the visit calendar; without it the link is not drawn.
 */
export function StoreVisits({ visits, calendarHref, t }: { visits: readonly StoreVisit[] | null; calendarHref: string | null; t: T }) {
  if (visits === null || visits.length === 0) return null;
  const sorted = [...visits].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return (
    <section aria-labelledby="visits-heading" data-part="visits" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="visits-heading" className="font-display text-xl font-semibold">
          {t("today.visits.title")}
        </h2>
        <span className="text-sm text-muted">{sorted.length === 1 ? t("today.visits.one") : t("today.visits.other", { n: sorted.length })}</span>
      </div>
      <ul className="flex flex-col gap-3.5">
        {sorted.map((v) => (
          <li key={v.id} className="flex gap-3.5">
            <span className="w-14 flex-none font-bold tabular-nums">{indiaClock(v.starts_at)}</span>
            <div className="min-w-0 flex-1 border-b border-line pb-3.5 last:border-b-0 last:pb-0">
              <p className="font-semibold [overflow-wrap:anywhere]">{v.extra > 0 ? `${v.who} + ${v.extra}` : v.who}</p>
              {v.topic ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{v.topic}</p> : null}
              <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${STATUS_TONE[v.status]}`}>{t(STATUS_WORD[v.status])}</span>
            </div>
          </li>
        ))}
      </ul>
      {calendarHref ? (
        <Link href={calendarHref} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">
          {t("today.visits.cal")}
        </Link>
      ) : null}
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
 * "Your team" (job AU): the six helpers as owls in their own colours (owl-colors.ts), the name and ONE live status line each, from the helpers' status (`GET /agents/status`): working, switched off, not
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
        <ul className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3">
          {helpers.map((a) => (
            <li key={a.agent} className="flex min-w-0 flex-col items-center gap-1 text-center">
              <OwlSvg agent={a.agent} mood={a.state === "working" ? "thinking" : a.state === "idle" ? "idle" : "resting"} still className="size-12" />
              <span className="text-sm font-semibold">{t(`agent.${a.agent}`)}</span>
              <span className={`line-clamp-2 text-sm leading-snug [overflow-wrap:anywhere] ${a.state === "working" ? "font-semibold text-brand-text" : "text-muted"}`}>{statusLine(a, t, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
