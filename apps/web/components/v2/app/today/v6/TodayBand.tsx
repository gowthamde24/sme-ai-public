"use client";

import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { makeT, type Words } from "../../words";
import { AskAnswer } from "../ask/AskView";
import type { Availability } from "../ask/ask-types";
import type { AskWords } from "../ask/ask-words";
import { CHAT_LANGS } from "../ask/chat-language";
import { linePieces, type BandFacts, type TopDecision } from "./band-data";
import { CommandBar6 } from "./CommandBar6";
import { LazyLiveBar } from "./LazyLiveBar";
import { OrbRing } from "./OrbRing";
import type { LiveCallSeed } from "./types";
import { useLiveCall } from "./use-live-call";
import { LiveNow } from "../../live/LazyLiveNow";
import { usePlanSubmit } from "./use-plan-submit";
import { setTalking, useIsDesktop, useTalkMood, useTalking } from "./v6-state";
import { clock } from "../../ds/talk/use-talk-live";

export type BandProps = {
  lang: string;
  base: string;
  availability: Availability;
  /** "Good morning, Gowtham". */
  greeting: string;
  /** "Friday, 13 November". */
  dateLine: string;
  /** The business's name (the eyebrow). */
  shop: string;
  facts: BandFacts;
  /** The quote at the top of the list (the briefing's link), or null. */
  top: TopDecision | null;
  waiting: number | null;
  /** The workspace id, for the live-call poll. */
  tenantId: string;
  /** Staging (CALL_SCREENS=mock and `?live=1`): a made-up live call. */
  mockLive: { caller: string } | null;
  /** The calls live now, read by the page from the calls list. */
  liveCalls?: readonly LiveCallSeed[];
  /** "Finish setup N/7" (a small chip in the eyebrow), or nothing. */
  chip?: React.ReactNode;
  /** `tv6.` and `dst.` words. */
  words: Words;
  askWords: AskWords;
  chips: readonly string[];
  /** The language name shown on the live bar (the phone has no dropdown). */
  language: string;
  /** The business's own language code (its profile), for the language dropdown. */
  businessLang?: string | null;
};

/** A string with `{name}` places made into pieces of JSX (a number in bold, a link): the words stay whole sentences in the string store. */
export function rich(template: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/g).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return m && m[1] in parts ? <React.Fragment key={i}>{parts[m[1]]}</React.Fragment> : <React.Fragment key={i}>{piece}</React.Fragment>;
  });
}

/** The band's first line: the date, the business, and "Ready to answer" with a green dot; while a call is live it is red, "On a call · <name> · 1:24 · Listen" (Listen opens the call's page). */
function Eyebrow({ p }: { p: BandProps }) {
  const t = makeT(p.words);
  const call = useLiveCall(p.tenantId, p.mockLive, p.liveCalls ?? []);
  return (
    <div data-part="eyebrow" className="flex min-w-0 flex-wrap items-center gap-y-1.5 text-[11.5px] uppercase tracking-[0.12em] text-muted">
      <span className="min-w-0 truncate">
        {p.dateLine} · {p.shop}
      </span>
      {call ? (
        <span data-part="on-call" className="ml-3 inline-flex items-center gap-2 border-l border-line pl-3 normal-case tracking-[0.02em] text-red-text">
          <i aria-hidden="true" className="size-[7px] rounded-full bg-red-text shadow-[0_0_0_4px_rgba(251,113,133,0.2)]" />
          <span>
            {t("tv6.eye.oncall")} · <b className="font-bold text-ink">{call.caller || t("tv6.st.unknown")}</b> · <span className="tabular-nums">{clock(call.seconds)}</span>
          </span>
          <Link href={call.id ? `${p.base}/calls/${call.id}` : `${p.base}/calls`} className="font-bold text-ink underline decoration-[rgba(251,146,60,0.8)] underline-offset-2">
            {t("tv6.st.listen")}
          </Link>
        </span>
      ) : (
        <span data-part="ready" className="ml-3 inline-flex items-center gap-[7px] border-l border-line pl-3 tracking-[0.04em] text-green-text">
          <i aria-hidden="true" className="size-[7px] rounded-full bg-green-text shadow-[0_0_0_4px_rgba(34,197,94,0.2)]" />
          {t("tv6.st.ready")}
        </span>
      )}
      {p.chip ? (
        <span data-part="eyebrow-chip" className="ml-3 normal-case tracking-normal">
          {p.chip}
        </span>
      ) : null}
      {/* "Watching for leads" (or what the assistant is doing now): small, in the eyebrow; it draws nothing until its first poll answers */}
      <span data-part="eyebrow-live" className="ml-3 normal-case tracking-normal [&_button]:min-h-7 [&_button]:text-xs [&_p]:min-h-7 [&_p]:py-0 [&_p]:text-xs">
        <LiveNow tenantId={p.tenantId} />
      </span>
    </div>
  );
}

/** The briefing (17px): today's facts from the business's own data, the key ones bright, and the top decision as an underlined link (a quote opens the quote; otherwise the list). The Approve button lives in Needs you, not here. */
export function Briefing({ facts, top, waiting, words }: { facts: BandFacts; top: TopDecision | null; waiting: number | null; words: Words }) {
  const t = makeT(words);
  const pieces = linePieces(facts);
  const enq = pieces.find((x) => x.key === "enq");
  const vis = pieces.find((x) => x.key === "visits");
  const enqNode = enq ? <b>{t(`tv6.line.enq.${enq.n === 1 ? "one" : "other"}`, { n: enq.n })}</b> : null;
  const visNode = vis ? <b className="ds-hl">{t(`tv6.line.visits.${vis.n === 1 ? "one" : "other"}`, { n: vis.n })}</b> : null;
  const first = enqNode && visNode ? rich(t("tv6.brief.both"), { enq: enqNode, visits: visNode }) : enqNode ? rich(t("tv6.brief.enq"), { enq: enqNode }) : visNode ? rich(t("tv6.brief.visits"), { visits: visNode }) : null;
  let second: React.ReactNode = null;
  if (top) second = rich(t("tv6.brief.quote"), { link: <Link href={top.href}>{t("tv6.brief.quote.link", { amount: top.amountText, name: top.name })}</Link> });
  else if (waiting !== null && waiting > 0) second = rich(t(waiting === 1 ? "tv6.brief.waiting.one" : "tv6.brief.waiting.other"), { link: <a href="#needs-you">{t(waiting === 1 ? "tv6.brief.waiting.one.link" : "tv6.brief.waiting.other.link", { n: waiting })}</a> });
  else if (waiting === 0) second = t("tv6.brief.none");
  if (!first && !second) return null;
  return (
    <p data-part="briefing" className="ds-brief text-balance">
      {first}
      {first && second ? " " : null}
      {second}
    </p>
  );
}

/** The real orb with its halo, tick ring and the glass "Tap to talk" pill under it (desktop). Tapping it turns the composer into the live conversation, in place; the orb follows what the conversation does. */
function BigOrb({ words }: { words: Words }) {
  const t = makeT(words);
  const talking = useTalking();
  const mood = useTalkMood();
  const state = mood === "speaking" ? "speak" : mood === "thinking" ? "think" : mood === "listening" ? "listen" : "ambient";
  return (
    <button type="button" data-part="band-orb" onClick={() => setTalking(!talking)} aria-label={t("tv6.tap")} aria-pressed={talking} className="ds-orbz max-md:hidden focus-visible:outline-2">
      <span aria-hidden="true" className="ds-orbz-halo" />
      <span className="ds-orbz-in">
        <OrbRing state={state} size="xl" />
      </span>
      <span className="ds-tap">
        <i aria-hidden="true" />
        {t("tv6.tap")}
      </span>
    </button>
  );
}

/**
 * Today's dark band (design system v6, the final design; behind DESIGN_V6): glossy dark in both themes. The eyebrow, the 38px greeting, the 17px briefing with the link to the top decision, the real orb with its halo and "Tap to talk", and the composer (ghost completion, three chips, language, mic, "Do it").
 * On a phone it is compact: the greeting, the briefing and a small orb (tap = talk live); the composer is the bottom bar. It is a lazy chunk (`LazyTodayBand`): Today's first paint does not carry it.
 */
export function TodayBand(p: BandProps) {
  const t = makeT(p.words);
  const talking = useTalking();
  const desktop = useIsDesktop();
  return (
    <section data-part="band" aria-label={p.greeting} className="ds-hero min-w-0">
      <Eyebrow p={p} />
      <div className="relative">
        <h2 data-part="greeting" className="ds-greet mt-1.5 pr-20 font-display font-extrabold text-ink md:pr-0">
          {p.greeting}
        </h2>
        <button type="button" data-part="phone-orb" onClick={() => setTalking(!talking)} aria-label={t("tv6.tap")} aria-pressed={talking} className="absolute right-0 top-0 rounded-full md:hidden">
          <OrbRing state="ambient" size="sm" />
        </button>
      </div>
      <Briefing facts={p.facts} top={p.top} waiting={p.waiting} words={p.words} />
      {talking && !desktop ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-black/30">
          <LazyLiveBar variant="bar" words={p.words} language={p.language} onClose={() => setTalking(false)} />
        </div>
      ) : null}
      <div className="mt-[22px] flex items-center gap-[22px] max-md:hidden">
        <BigOrb words={p.words} />
        <CommandBar6 lang={p.lang} base={p.base} availability={p.availability} words={p.words} askWords={p.askWords} chips={p.chips} businessLang={p.businessLang ?? null} />
      </div>
    </section>
  );
}

/**
 * The phone's bottom bar (the final design): a "Hold to speak" bar with the orb in its button. Pressing and holding the orb is the mock talk (voice is mocked on staging): the live conversation opens in place in the band; a pill beside it takes written instructions into the plan flow.
 * Under it: "Hold to speak in <language>".
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
          <input id="phone-ask" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={t("tv6.ph.tell")} autoComplete="off" className="min-h-12 min-w-0 flex-1 border-0 bg-transparent p-0 text-base text-ink outline-none placeholder:text-muted" />
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
            className={`grid size-14 shrink-0 touch-none select-none place-items-center rounded-full bg-charcoal shadow-[0_0_0_5px_var(--ds-glow)] ${held ? "ring-4 ring-brand-edge" : ""}`}
          >
            <Orb px={44} state={held || talking ? "listen" : "ambient"} />
          </button>
        </form>
        <p data-part="hold-hint" className="mt-1.5 truncate text-center text-sm text-muted">
          {held ? t("tv6.hold.release") : t("tv6.hold.in", { language: spoken })}
        </p>
      </div>
    </>
  );
}

/** What comes after the sections on a phone: the plan card of a job just started, and the fixed bottom bar. Nothing on a desktop. */
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
