import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { OwlSvg } from "../owl/OwlSvg";
import type { Slots, StoreSettings, Visit } from "@/lib/api/visits";

import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import type { VisitsActions } from "./actions-types";
import { BookVisit } from "./BookVisit";
import { closedWord } from "./closed-word";
import { dayHeading, shiftDay } from "./dates";
import { HoursForm } from "./HoursForm";
import { card, field, secondary } from "./styles";
import { VisitCard } from "./VisitCard";

const FINISHED: ReadonlySet<Visit["status"]> = new Set(["completed", "no_show", "cancelled"]);
const navButton = "inline-flex size-11 items-center justify-center rounded-full border border-edge bg-surface hover:bg-surface-2";

export type VisitsViewProps = {
  /** The "?" tip of the screen (job BT): drawn under the heading. */
  help?: React.ReactNode;
  view: "day" | "hours";
  day: string;
  /** Today in India (`YYYY-MM-DD`) and the moment the page was drawn (ms): read once so the page and a test agree. */
  today: string;
  now: number;
  lang: string;
  role: Role;
  base: string;
  words: TodayWords;
  /** null = the day's visits could not be read. */
  visits: Visit[] | null;
  /** null = the day's slots could not be read. */
  slots: Slots | null;
  /** null = the hours could not be read. */
  hours: StoreSettings | null;
  actions: VisitsActions;
  /** The lead the person came from ("Book a store visit" on its page), if any. */
  lead: { leadId: string; label: string } | null;
  /** A time (`HH:MM`) chosen from the free times. */
  time: string | null;
  /** The visit to point at (the link of a card or of the Ask box). */
  focus: string | null;
};

/** The Visits page (job AV), drawn from what the server read: it only draws; a part that could not be read says "Not available yet" in its place. */
export function VisitsView(p: VisitsViewProps) {
  const { view, day, today, words, base, role, lang } = p;
  const canBook = role !== "viewer";
  const href = (date: string, extra = "") => `${base}/visits?date=${date}${extra}`;
  const tab = (on: boolean) => `-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-base ${on ? "border-brand-edge font-semibold text-brand-text" : "border-transparent font-medium text-muted hover:text-ink"}`;
  const live = (p.visits ?? []).filter((v) => !FINISHED.has(v.status));
  const finished = (p.visits ?? []).filter((v) => FINISHED.has(v.status));
  const freeSlots = (p.slots?.slots ?? []).filter((s) => s.free > 0 && !s.past);
  const startSlot = p.time && p.slots?.slots.some((s) => s.start === p.time && s.free > 0) ? p.time : null;

  return (
    <div data-screen="visits" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "nav.item.visits")}</h1>
        <p className="text-base text-muted">{say(words, "visits.sub")}</p>
      </header>
      {p.help}
      <nav aria-label={say(words, "nav.item.visits")} className="flex gap-1 border-b border-line">
        <Link href={href(day)} aria-current={view === "day" ? "page" : undefined} className={tab(view === "day")}>
          {say(words, "visits.tab.day")}
        </Link>
        <Link href={`${base}/visits?view=hours`} aria-current={view === "hours" ? "page" : undefined} className={tab(view === "hours")}>
          {say(words, "visits.tab.hours")}
        </Link>
      </nav>

      {view === "hours" ? (
        p.hours ? (
          <HoursForm words={words} lang={lang} settings={p.hours} canEdit={role === "owner" || role === "admin"} save={p.actions.saveHours} />
        ) : (
          <div className={card}>
            <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
          </div>
        )
      ) : (
        <>
          <section aria-label={say(words, "visits.day.nav")} className="flex flex-wrap items-center gap-2">
            <Link href={href(shiftDay(day, -1))} aria-label={say(words, "visits.day.prev")} className={navButton}>
              <ChevronLeft className="size-5" aria-hidden="true" />
            </Link>
            <h2 data-day={day} className="min-w-0 flex-1 text-center font-display text-lg font-semibold md:flex-none md:px-3 md:text-xl">
              {dayHeading(day, lang)}
            </h2>
            <Link href={href(shiftDay(day, 1))} aria-label={say(words, "visits.day.next")} className={navButton}>
              <ChevronRight className="size-5" aria-hidden="true" />
            </Link>
            {day !== today ? (
              <Link href={href(today)} className={secondary}>
                {say(words, "visits.day.today")}
              </Link>
            ) : null}
            <form method="get" action={`${base}/visits`} className="ml-auto flex items-center gap-2 max-md:basis-full">
              <label htmlFor="visits-date" className="sr-only">
                {say(words, "visits.day.pick")}
              </label>
              <input id="visits-date" name="date" type="date" defaultValue={day} className={`${field} w-auto`} />
              <button type="submit" className={secondary}>
                {say(words, "visits.day.show")}
              </button>
            </form>
          </section>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              {p.visits === null ? (
                <div className={card}>
                  <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
                </div>
              ) : p.visits.length === 0 ? (
                <div className={`${card} flex-row items-center`} data-empty="visits">
                  <OwlSvg agent="main" mood="idle" still className="size-14" />
                  <p className="font-medium">{say(words, day < today ? "visits.empty.past" : "visits.empty")}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted">{say(words, p.visits.length === 1 ? "visits.count.one" : "visits.count.other", { n: p.visits.length })}</p>
                  <ul className="flex flex-col gap-3">
                    {live.map((v) => (
                      <li key={v.id} id={`v-${v.id}`} className={`scroll-mt-24 rounded-[20px] ${p.focus === v.id ? "ring-2 ring-brand-edge" : ""}`}>
                        <VisitCard visit={v} role={role} actions={p.actions} words={words} lang={lang} now={p.now} today={today} base={base} slotsMin={today} />
                      </li>
                    ))}
                  </ul>
                  {finished.length > 0 ? (
                    <section aria-labelledby="finished-heading" className="flex flex-col gap-3">
                      <h3 id="finished-heading" className="font-display text-lg font-semibold">
                        {say(words, "visits.finished")}
                      </h3>
                      <ul className="flex flex-col gap-3">
                        {finished.map((v) => (
                          <li key={v.id} id={`v-${v.id}`} className={`scroll-mt-24 rounded-[20px] ${p.focus === v.id ? "ring-2 ring-brand-edge" : ""}`}>
                            <VisitCard visit={v} role={role} actions={p.actions} words={words} lang={lang} now={p.now} today={today} base={base} slotsMin={today} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              )}

              <section aria-labelledby="free-heading" className={card} data-part="free-times">
                <h3 id="free-heading" className="font-display text-lg font-semibold">
                  {say(words, "visits.free.title")}
                </h3>
                {p.slots === null ? (
                  <p className="text-sm text-muted">{say(words, "frame.notyet")}</p>
                ) : p.slots.slots.length === 0 ? (
                  <p className="text-sm text-muted">{closedWord(words, p.slots.reason)}</p>
                ) : freeSlots.length === 0 ? (
                  <p className="text-sm text-muted">{say(words, "visits.free.none")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {freeSlots.map((s) => (
                      <li key={s.start}>
                        {canBook ? (
                          <Link href={href(day, `&time=${s.start}#book`)} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-3.5 text-base font-semibold tabular-nums hover:bg-surface-2">
                            {s.start}
                            <span className="ml-1.5 text-sm font-normal text-muted">{say(words, "visits.slot.free", { n: s.free })}</span>
                          </Link>
                        ) : (
                          <span className="inline-flex min-h-11 items-center rounded-full border border-line px-3.5 text-base font-semibold tabular-nums">{s.start}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <aside className="min-w-0">
              {canBook ? (
                <BookVisit key={`${day}-${startSlot ?? ""}-${p.lead?.leadId ?? ""}`} words={words} lang={lang} actions={p.actions} today={today} start={{ date: day, slot: startSlot }} lead={p.lead} slots={p.slots} />
              ) : (
                <div className={card}>
                  <p className="text-sm text-muted">{say(words, "visits.viewer")}</p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
