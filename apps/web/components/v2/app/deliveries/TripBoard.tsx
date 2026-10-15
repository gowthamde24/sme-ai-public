import Link from "next/link";

import type { TripOut } from "@contracts";

import { PlushStill } from "../owl/PlushStill";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { card, okLine, secondary } from "../visits/styles";
import { TripCard, type TripCardActions } from "./TripCard";
import { addDays } from "./trip-logic";

const ORDER = ["on_the_way", "loaded", "planned", "problem", "delivered", "cancelled"] as const;

export type TripBoardProps = {
  base: string;
  words: TodayWords;
  role: Role;
  day: string;
  today: string;
  /** null = the trips could not be read. */
  trips: readonly TripOut[] | null;
  sites: Readonly<Record<string, string>>;
  actions: TripCardActions;
  saved: boolean;
};

/**
 * The trips of one day (job CO), grouped by where they stand: on the way first, then loaded, planned, problems, delivered. Each card has the next step in one tap. The day moves with the arrows; the order's own page plans
 * new trips. Owner, Admin and Sales do all of it; a Viewer sees nothing here.
 */
export function TripBoard({ base, words, role, day, today, trips, sites, actions, saved }: TripBoardProps) {
  const here = `${base}/orders/trips`;
  const link = (d: string) => (d === today ? here : `${here}?date=${d}`);
  const grouped = ORDER.map((s) => [s, (trips ?? []).filter((t) => t.status === s)] as const).filter(([, list]) => list.length > 0);
  return (
    <div data-screen="trips" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{say(words, "trip.board.title")}</h1>
        <p className="text-base text-muted">{say(words, "trip.board.sub")}</p>
      </header>
      {saved ? <p role="status" className={okLine}>{say(words, "trip.saved")}</p> : null}
      <nav aria-label={say(words, "trip.board.days")} className="flex flex-wrap items-center gap-2">
        <Link href={link(addDays(day, -1))} className={secondary} aria-label={say(words, "trip.board.prev")}>←</Link>
        <p className="min-w-40 text-center font-display text-xl font-bold" aria-live="polite">{day === today ? say(words, "trip.board.today", { date: day }) : day}</p>
        <Link href={link(addDays(day, 1))} className={secondary} aria-label={say(words, "trip.board.next")}>→</Link>
        {day !== today ? <Link href={here} className={secondary}>{say(words, "trip.board.gotoday")}</Link> : null}
      </nav>
      {trips === null ? (
        <div role="alert" className={`${card} flex-row items-center`} data-state="error">
          <PlushStill px={56} mood="resting" className="size-14" />
          <div>
            <p className="font-semibold">{say(words, "frame.notyet")}</p>
            <p className="text-sm text-muted">{say(words, "trip.board.error")}</p>
          </div>
        </div>
      ) : trips.length === 0 ? (
        <div className={`${card} items-start`} data-state="empty">
          <div className="flex items-center gap-3">
            <PlushStill px={64} mood="idle" className="size-16" />
            <h2 className="font-display text-2xl font-bold leading-tight">{say(words, "trip.board.empty.title")}</h2>
          </div>
          <p className="text-base text-muted">{say(words, "trip.board.empty.body")}</p>
          <Link href={`${base}/orders`} className={secondary}>{say(words, "trip.board.orders")}</Link>
        </div>
      ) : (
        grouped.map(([status, list]) => (
          <section key={status} aria-labelledby={`trips-${status}`} className="flex flex-col gap-2" data-group={status}>
            <h2 id={`trips-${status}`} className="font-display text-xl font-bold">{say(words, `trip.status.${status}`)} <span className="font-normal text-muted">({list.length})</span></h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((t) => (
                <TripCard key={t.id} trip={t} base={base} siteLabel={t.site_id ? (sites[t.site_id] ?? null) : null} words={words} role={role} actions={actions} uploadUrl={`${base}/orders/trips/${t.id}/delivered`} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
