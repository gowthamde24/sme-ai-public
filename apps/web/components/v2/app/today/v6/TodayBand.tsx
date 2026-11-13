"use client";

import { Mic } from "lucide-react";
import * as React from "react";

import { makeT, type Words } from "../../words";
import { AskAnswer } from "../ask/AskView";
import { CHAT_LANGS } from "../ask/chat-language";
import type { Availability } from "../ask/ask-types";
import type { AskWords } from "../ask/ask-words";
import { headlineKey, linePieces, type BandFacts, type Suggestion } from "./band-data";
import { CommandBar6 } from "./CommandBar6";
import { LazyLiveBar } from "./LazyLiveBar";
import { OrbRing } from "./OrbRing";
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
  /** The business's own language code (its profile), for the language dropdown. */
  businessLang?: string | null;
};

/** A line with one token (a number or an amount) in bold. */
function Bold({ text, token }: { text: string; token: string }) {
  const at = text.indexOf(token);
  if (at < 0 || token === "") return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="font-bold text-ink">{token}</b>
      {text.slice(at + token.length)}
    </>
  );
}

/** The one line under the greeting: date · enquiries · visits booked · ₹ in quotes, the numbers in bold (a piece that cannot be read is left out). */
export function BandLine({ dateLine, facts, words }: { dateLine: string; facts: BandFacts; words: Words }) {
  const t = makeT(words);
  const parts = linePieces(facts).map((p) => {
    const token = p.key === "quotes" ? (p.amount ?? "") : String(p.n);
    const text = p.key === "quotes" ? t("tv6.line.quotes", { amount: p.amount ?? "" }) : t(`tv6.line.${p.key}.${p.n === 1 ? "one" : "other"}`, { n: p.n });
    return { key: p.key, text, token };
  });
  return (
    <p data-part="band-line" className="mt-1.5 text-sm text-muted">
      {dateLine}
      {parts.map((x) => (
        <React.Fragment key={x.key}>
          {" · "}
          <Bold text={x.text} token={x.token} />
        </React.Fragment>
      ))}
    </p>
  );
}

/** The phone's top (the approved mock): a small band card with the orb in its tick ring (tap = talk live) and the daily headline, "14 enquiries, 4 visits booked. 3 need you."; the live conversation takes its place while talking. */
function PhoneHead({ p }: { p: BandProps }) {
  const t = makeT(p.words);
  const talking = useTalking();
  const desktop = useIsDesktop();
  const head = headlineKey(p.waiting);
  const pieces = linePieces(p.facts).filter((x) => x.key !== "quotes");
  const good = pieces.map((x) => t(`tv6.line.${x.key}.${x.n === 1 ? "one" : "other"}`, { n: x.n })).join(", ");
  return (
    <section data-part="phone-head" aria-label={p.greeting} className="min-w-0 md:hidden">
      <h2 className="sr-only">{p.greeting}</h2>
      {talking && !desktop ? (
        <div className="rounded-[30px] border border-brand-edge bg-surface p-4">
          <LazyLiveBar words={p.words} language={p.language} onClose={() => setTalking(false)} />
        </div>
      ) : (
        <div className="ds-band flex min-w-0 items-center gap-3 rounded-[30px] border border-line p-3.5">
          <button type="button" data-part="phone-orb" onClick={() => setTalking(true)} aria-label={t("dst.talk_live")} className="shrink-0 rounded-full focus-visible:outline-2">
            <OrbRing size="md" state="ambient" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-muted">
              {p.dateLine} · <span aria-hidden="true" className="inline-block size-2 rounded-full bg-green-text align-middle" /> {t("tv6.st.ready")}
            </p>
            <p data-part="headline" className="font-display text-[22px] font-extrabold leading-[1.15] tracking-[-0.5px]">
              {good ? <span className="text-green-text">{good}. </span> : null}
              {head && p.waiting ? <span className="text-brand-text">{t(head.key, { n: head.n })}</span> : head ? <span>{t(head.key, { n: head.n })}</span> : null}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Today's top band (design system v6; behind DESIGN_V6): the greeting and its one line, the glowing command bar, the suggested row and the status card on a desktop; the greeting and the daily headline on a phone (below 768 px). It is a lazy chunk (`LazyTodayBand`): Today's
 * first paint does not carry it. Everything below the band is Today as it was.
 */
export function TodayBand(p: BandProps) {
  const [job, setJob] = React.useState<{ n: number; text: string } | null>(null);
  const { submit } = usePlanSubmit();
  return (
    <div data-part="today-band" className="flex flex-col gap-4">
      <PhoneHead p={p} />
      <SuggestedRow items={p.suggestions} words={p.words} variant="swipe" onStart={(text) => submit(text)} />
      <section data-part="band" className="ds-band grid min-w-0 items-start gap-[26px] rounded-[30px] border border-line p-[22px_22px_20px] max-md:hidden lg:grid-cols-[minmax(0,1fr)_390px] lg:p-[26px_28px_20px]">
        <div className="flex min-w-0 flex-col">
          <h2 data-part="greeting" className="font-display text-[32px] font-extrabold leading-[1.1] tracking-[-1px]">
            {p.greeting}
          </h2>
          <BandLine dateLine={p.dateLine} facts={p.facts} words={p.words} />
          <div className="mt-5">
            <CommandBar6 lang={p.lang} base={p.base} availability={p.availability} words={p.words} askWords={p.askWords} chips={p.chips} job={job} businessLang={p.businessLang ?? null} />
          </div>
          <div className="mt-[18px]">
            <SuggestedRow items={p.suggestions} words={p.words} variant="row" onStart={(text) => setJob((j) => ({ n: (j?.n ?? 0) + 1, text }))} />
          </div>
        </div>
        <StatusCard data={p.status} words={p.words} />
      </section>
    </div>
  );
}

/**
 * The phone's bottom bar (the approved mock): a white pill to write in ("Tell me what to do…", Enter sends it into the plan flow) and a big dark microphone. Pressing and holding the microphone is the mock talk (voice is mocked on staging): the live conversation opens in place
 * at the top; under the bar it says "Hold to speak in <language>".
 */
function PhoneBar({ words, language, businessLang }: { words: Words; language: string; businessLang?: string | null }) {
  const t = makeT(words);
  const [held, setHeld] = React.useState(false);
  const [text, setText] = React.useState("");
  const talking = useTalking();
  const { submit } = usePlanSubmit(undefined, () => setText(""));
  const release = () => setHeld(false);
  const spoken = CHAT_LANGS.find((l) => l.code === businessLang)?.native ?? language;
  return (
    <>
      <div aria-hidden="true" className="h-36 md:hidden" />
      <div data-part="phone-bar" data-lang={businessLang ?? ""} className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 bg-bg/95 px-3 pb-2 pt-3 backdrop-blur md:hidden print:hidden">
        <form
          data-write
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-5 pr-1.5 shadow-[0_10px_30px_var(--ds-glow)]"
        >
          <label htmlFor="phone-ask" className="sr-only">
            {t("tv6.cmd.label")}
          </label>
          <input id="phone-ask" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={t("tv6.ph.tell")} autoComplete="off" className="min-h-12 min-w-0 flex-1 border-0 bg-transparent p-0 text-lg text-ink outline-none placeholder:text-muted" />
          <button
            type="button"
            data-part="hold-to-speak"
            aria-label={t(held ? "tv6.hold.release" : "tv6.hold")}
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
            className={`grid size-14 shrink-0 touch-none select-none place-items-center rounded-full bg-charcoal text-on-charcoal shadow-[0_0_0_5px_var(--ds-glow)] ${held ? "ring-4 ring-brand-edge" : ""}`}
          >
            <Mic className="size-6" aria-hidden="true" />
          </button>
        </form>
        <p data-part="hold-hint" className="mt-1.5 truncate text-center text-sm text-muted">
          {held ? t("tv6.hold.release") : t("tv6.hold.in", { language: spoken })}
        </p>
      </div>
    </>
  );
}

/** What comes after the lower sections on a phone: the plan card of a job just started, and the fixed bottom bar. Nothing on a desktop. */
export function TodayBandAfter({ words, language = "", businessLang = null }: { words: Words; /** The UI language's own name (for "Hold to speak in …" when the business language is not known). */ language?: string; businessLang?: string | null }) {
  const { session } = usePlanSubmit();
  return (
    <div data-part="phone-after" className="flex flex-col gap-4 md:hidden">
      {session ? (
        <div className="empty:hidden">
          <AskAnswer session={session} chips={[]} earlierWord={session.w("ask.earlier")} />
        </div>
      ) : null}
      <PhoneBar words={words} language={language} businessLang={businessLang} />
    </div>
  );
}
