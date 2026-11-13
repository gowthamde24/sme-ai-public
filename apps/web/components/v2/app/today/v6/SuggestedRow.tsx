"use client";

import { formatRupeesShort } from "@/lib/money";

import { makeT, type Words } from "../../words";
import type { Suggestion } from "./band-data";

/** The title of one suggested job, in the person's language: "Call 3 new enquiries". */
export function titleOf(t: ReturnType<typeof makeT>, s: Suggestion): string {
  const key = s.id === "followups" ? "tv6.sug.follow" : s.id === "leads" ? "tv6.sug.leads" : "tv6.sug.quotes";
  return t(`${key}.${s.n === 1 ? "one" : "other"}`, { n: s.n });
}
/** The instruction the job puts into the plan flow (the owner still approves the plan it makes). */
export function sayOf(t: ReturnType<typeof makeT>, s: Suggestion): string {
  const key = s.id === "followups" ? "tv6.sug.follow" : s.id === "leads" ? "tv6.sug.leads" : "tv6.sug.quotes";
  return t(`${key}.say`, { n: s.n });
}
/** "about 4 min · about ₹18" for a calling job; "₹48,000 · about 2 min" for the quotes. */
export function metaOf(t: ReturnType<typeof makeT>, s: Suggestion): string {
  if (s.est) return `${s.est.timeText} · ${s.est.costText}`;
  return [s.amountPaise !== null ? formatRupeesShort(s.amountPaise) : null, t("tv6.sug.quick")].filter((x) => x !== null).join(" · ");
}

/**
 * The suggested row (design system v6): two or three jobs from the business's own data, each with its time, its ₹ and ONE button. `row` is the desktop's single line; `swipe` is the phone's cards that you swipe sideways (scroll-snap). The button hands the job to the
 * plan flow: it makes a plan card, and nothing starts until the owner approves it. The estimates are a mock of C1's `POST /billing/estimate` until that route exists.
 */
export function SuggestedRow({ items, words, variant, onStart }: { items: readonly Suggestion[]; words: Words; variant: "row" | "swipe"; onStart: (say: string) => void }) {
  const t = makeT(words);
  if (items.length === 0) return null;
  const swipe = variant === "swipe";
  return (
    <section data-part="suggested" data-variant={variant} aria-label={t("tv6.sug.label")} className={swipe ? "min-w-0 md:hidden" : "max-md:hidden"}>
      <ul className={swipe ? "-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1" : "flex flex-wrap items-center gap-2.5"}>
        {!swipe ? (
          <li aria-hidden="true" className="mr-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
            {t("tv6.sug.label")}
          </li>
        ) : null}
        {items.map((s) => (
          <li key={s.id} data-suggestion={s.id} className={`flex min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface py-2 pl-3.5 pr-2 text-[13.5px] ${swipe ? "shrink-0 snap-center" : ""}`}>
            <span className="min-w-0 truncate">{titleOf(t, s)}</span>
            <small className="shrink-0 text-[12.5px] text-muted">{metaOf(t, s)}</small>
            <button type="button" data-write onClick={() => onStart(sayOf(t, s))} className={`inline-flex shrink-0 items-center justify-center rounded-[10px] ${swipe ? "min-h-11" : "min-h-8"} bg-charcoal px-3 text-[12.5px] font-bold text-on-charcoal hover:brightness-110`}>
              {t("tv6.sug.start")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
