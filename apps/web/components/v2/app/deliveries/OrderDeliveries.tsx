import Link from "next/link";

import type { TripOut } from "@contracts";

import { Pill } from "../parts";
import { say, type TodayWords } from "../today/today-words";
import { primary, secondary } from "../visits/styles";
import { groupIndianSafe } from "./format";

const TONE = { planned: "neutral", loaded: "info", on_the_way: "brand", delivered: "green", problem: "red", cancelled: "neutral" } as const;

/** The deliveries of one building-materials order (job CO): its trips with their state, a button to plan the next one and a link to the day's board. A closed or cancelled order cannot have new trips (the API says so). */
export function OrderDeliveries({ base, orderId, trips, words, canPlan }: { base: string; orderId: string; trips: readonly TripOut[] | null; words: TodayWords; canPlan: boolean }) {
  return (
    <section aria-labelledby="order-trips" className="mt-8 flex flex-col gap-3" data-part="order-deliveries">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="order-trips" className="font-display text-2xl font-bold leading-tight">{say(words, "trip.order.title")}</h2>
        <div className="flex flex-wrap gap-2">
          {canPlan ? <Link href={`${base}/orders/${orderId}/trips/new`} className={primary}>{say(words, "trip.plan.title")}</Link> : null}
          <Link href={`${base}/orders/trips`} className={secondary}>{say(words, "trip.board.title")}</Link>
        </div>
      </div>
      {trips === null ? (
        <p role="alert" className="text-base text-muted">{say(words, "trip.board.error")}</p>
      ) : trips.length === 0 ? (
        <p className="text-base text-muted">{say(words, "trip.order.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {trips.map((t) => (
            <li key={t.id}>
              <Link href={`${base}/orders/trips/${t.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 hover:border-brand-edge">
                <span className="font-semibold">{say(words, "trip.title", { order: t.order_no, n: t.trip_no })}</span>
                <span className="text-sm text-muted">{t.planned_date} · {t.lines.map((l) => `${groupIndianSafe(l.quantity)} ${l.unit}`).join(", ")}</span>
                <Pill tone={TONE[t.status]}>{say(words, `trip.status.${t.status}`)}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
