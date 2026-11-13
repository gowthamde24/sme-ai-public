"use client";

import { Mic } from "lucide-react";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { makeT, type Words } from "../../words";
import { AskAnswer } from "../ask/AskView";
import type { Availability } from "../ask/ask-types";
import type { AskWords } from "../ask/ask-words";
import { headlineKey, linePieces, type BandFacts, type Suggestion } from "./band-data";
import { CommandBar6, TalkBadge } from "./CommandBar6";
import { LazyLiveBar } from "./LazyLiveBar";
import { StatusCard, type StatusData } from "./StatusCard";
import { SuggestedRow } from "./SuggestedRow";
import { usePlanSubmit } from "./use-plan-submit";
import { setTalking, useIsDesktop, useTalking } from "./v6-state";

export type BandProps = {
  lang: string;
  base: string;
  availability: Availability;
  /** "Good morning, Gowtham". */
  greeting: string;
  /** "Friday, 13 November". */
  dateLine: string;
  facts: BandFacts;
  waiting: number | null;
  suggestions: readonly Suggestion[];
  status: StatusData;
  /** `tv6.` and `dst.` words. */
  words: Words;
  askWords: AskWords;
  chips: readonly string[];
  /** The language name shown on the live bar (the phone has no pill). */
  language: string;
};

/** The one line under the greeting: date · enquiries · visits booked · ₹ in quotes (a piece that cannot be read is left out). */
export function BandLine({ dateLine, facts, words }: { dateLine: string; facts: BandFacts; words: Words }) {
  const t = makeT(words);
  const parts = linePieces(facts).map((p) => (p.key === "quotes" ? t("tv6.line.quotes", { amount: p.amount ?? "" }) : t(`tv6.line.${p.key}.${p.n === 1 ? "one" : "other"}`, { n: p.n })));
  return (
    <p data-part="band-line" className="text-base text-muted">
      {[dateLine, ...parts].join(" · ")}
    </p>
  );
}

/** The phone's top: the small circle (tap = talk live) and the daily headline; the live conversation takes its place while talking. */
function PhoneHead({ p }: { p: BandProps }) {
  const t = makeT(p.words);
  const talking = useTalking();
  const desktop = useIsDesktop();
  const head = headlineKey(p.waiting);
  return (
    <section data-part="phone-head" aria-label={p.greeting} className="md:hidden">
      {talking && !desktop ? (
        <div className="rounded-2xl border border-brand-edge bg-surface p-4">
          <LazyLiveBar words={p.words} language={p.language} onClose={() => setTalking(false)} />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button type="button" data-part="phone-orb" onClick={() => setTalking(true)} aria-label={t("dst.talk_live")} className="flex shrink-0 flex-col items-center rounded-2xl p-1 focus-visible:outline-2">
            <Orb px={48} state="ambient" />
            <TalkBadge label={t("dst.talk_live")} />
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold leading-tight">{p.greeting}</h2>
            {head ? (
              <p data-part="headline" className="text-base text-muted">
                {t(head.key, { n: head.n })}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Today's top band (design system v6; behind DESIGN_V6): the greeting and its one line, the glowing command bar, the suggested row and the status card on a desktop; the small circle and the daily headline on a phone (below 768 px). It is a lazy chunk (`LazyTodayBand`): Today's
 * first paint does not carry it. Everything below the band is Today as it was.
 */
export function TodayBand(p: BandProps) {
  const [job, setJob] = React.useState<{ n: number; text: string } | null>(null);
  return (
    <div data-part="today-band" className="flex flex-col gap-4">
      <PhoneHead p={p} />
      <div className="flex flex-col gap-1 max-md:hidden">
        <h2 data-part="greeting" className="font-display text-[32px] font-semibold leading-[1.1]">
          {p.greeting}
        </h2>
        <BandLine dateLine={p.dateLine} facts={p.facts} words={p.words} />
      </div>
      <div className="grid gap-4 max-md:hidden lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <CommandBar6 lang={p.lang} base={p.base} availability={p.availability} words={p.words} askWords={p.askWords} chips={p.chips} job={job} />
          <SuggestedRow items={p.suggestions} words={p.words} variant="row" onStart={(text) => setJob((j) => ({ n: (j?.n ?? 0) + 1, text }))} />
        </div>
        <StatusCard data={p.status} words={p.words} />
      </div>
    </div>
  );
}

/** The phone's bottom bar: a big microphone, "Hold to speak". Pressing and holding is the mock talk (voice is mocked on staging): the live conversation opens in place at the top; a tap of the circle up there does the same. */
function PhoneBar({ words }: { words: Words }) {
  const t = makeT(words);
  const [held, setHeld] = React.useState(false);
  const talking = useTalking();
  const release = () => setHeld(false);
  return (
    <>
      <div aria-hidden="true" className="h-24 md:hidden" />
      <div data-part="phone-bar" className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-bg/95 p-3 backdrop-blur md:hidden print:hidden">
        <button
          type="button"
          data-part="hold-to-speak"
          aria-pressed={talking}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            setHeld(true);
            setTalking(true);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => {
            if (e.detail === 0) setTalking(!talking); // a keyboard or a screen reader: one press opens, the next closes
          }}
          className={`flex min-h-14 w-full touch-none select-none items-center justify-center gap-3 rounded-full border border-brand-edge text-lg font-semibold ${held ? "bg-brand text-on-brand" : "bg-brand-bg text-brand-text"}`}
        >
          <Mic className="size-6" aria-hidden="true" />
          {t(held ? "tv6.hold.release" : "tv6.hold")}
        </button>
      </div>
    </>
  );
}

/** What comes after Needs you on a phone: the suggestions you swipe sideways, the plan card of a job just started, and the fixed bottom bar. Nothing on a desktop (its suggestions are in the band). */
export function TodayBandAfter({ suggestions, words }: { suggestions: readonly Suggestion[]; words: Words }) {
  const { session, submit } = usePlanSubmit();
  return (
    <div data-part="phone-after" className="flex flex-col gap-4 md:hidden">
      <SuggestedRow items={suggestions} words={words} variant="swipe" onStart={(text) => submit(text)} />
      {session ? (
        <div className="empty:hidden">
          <AskAnswer session={session} chips={[]} earlierWord={session.w("ask.earlier")} />
        </div>
      ) : null}
      <PhoneBar words={words} />
    </div>
  );
}
