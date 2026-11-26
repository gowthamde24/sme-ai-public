"use client";

import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { makeT, type Words } from "../../words";
import { LazyAskAnswer } from "../ask/LazyAskAnswer";
import { useAskAwake, wakeAsk } from "../ask/ask-wake";
import type { Availability } from "../ask/ask-types";
import type { AskWords } from "../ask/ask-words";
import { CHAT_LANGS } from "../ask/chat-language";
import type { BandFacts, TopDecision } from "./band-data";
import { Briefing } from "./Briefing";
import { sendsOnEnter } from "../composer-keys";
import { LightNote, useLightUntil } from "./LightNote";
import { CommandBar6 } from "./CommandBar6";
import { LazyLiveBar, warmLiveBar } from "./LazyLiveBar";
import { OrbRing } from "./OrbRing";
import type { LiveCallSeed } from "./types";
import { useLiveCall } from "./use-live-call";
import { usePlanSubmit } from "./use-plan-submit";
import { primeAudio } from "@/lib/browser-voice/audio-io";
import { isVoiceLang } from "@/lib/browser-voice/langs";
import { getTalkBarge, getTalkMood, setTalking, useIsDesktop, useTalkAnalyser, useTalkMood, useTalking } from "./v6-state";
import { clock } from "../../ds/talk/clock";
import { pokeLiveCalls } from "../../live/live-calls-store";

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
  facts?: BandFacts;
  /** The quote at the top of the list (the briefing's link), or null. */
  top?: TopDecision | null;
  waiting?: number | null;
  /** The briefing already made (the page draws it in its own part, `<Briefing/>` under a Suspense, because it waits for less than the rest of the page): drawn in place of the one made from `facts`, `top` and `waiting`. */
  briefing?: React.ReactNode;
  /** The workspace id, for the live-call poll. */
  tenantId: string;
  /** Staging (CALL_SCREENS=mock and `?live=1`): a made-up live call. */
  mockLive: { caller: string } | null;
  /** The calls live now, read by the page from the calls list. */
  liveCalls?: readonly LiveCallSeed[];
  /** "Start demo call" / "End demo call" next to the status (a DEMO workspace, Owner and Admin): C1's simulated live call; null = not offered. */
  demoCall?: { start: () => Promise<{ ok: boolean }>; end: () => Promise<{ ok: boolean }> } | null;
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

/** The demo's one button (owner, 13 Nov 2026): a labelled simulated live call, started or ended with C1's demo routes; the page is refreshed so the live screens follow. A failure is said in words, never silence. */
function DemoCallButton({ demoCall, live, t, tenantId }: { demoCall: NonNullable<BandProps["demoCall"]>; live: boolean; t: ReturnType<typeof makeT>; tenantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const run = async () => {
    setBusy(true);
    setFailed(false);
    const out = await (live ? demoCall.end() : demoCall.start()).catch(() => ({ ok: false }));
    setBusy(false);
    if (out.ok) {
      router.refresh();
      pokeLiveCalls(tenantId); // the live strip follows now, not at the next idle poll
    }
    else setFailed(true);
  };
  return (
    <span data-part="demo-call" className="inline-flex flex-wrap items-center gap-2 normal-case tracking-normal">
      <button type="button" onClick={() => void run()} disabled={busy} title={t("tv6.demo.hint")} className="inline-flex min-h-8 items-center rounded-md border border-line bg-surface-2 px-3 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-60 max-md:min-h-11">
        {live ? t("tv6.demo.end") : t("tv6.demo.start")}
      </button>
      {failed ? (
        <span role="alert" className="text-xs font-medium text-red-text">
          {t("tv6.demo.fail")}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The band's first line: the date and the business, then "Ready to answer" with a green dot; while a call is live it is red, "On a call · <name> · 1:24 · Listen" (Listen opens the call's page). Owner, 13 Nov 2026: the line holds the date, the shop and the status only; "Finish setup N/7" is a small chip on its own line under it, and "Watching for leads" is gone (the status says it).
 * On a phone it is compact (mockI3): line 1 the date only, line 2 the status, line 3 one row of small chips.
 */
function Eyebrow({ p }: { p: BandProps }) {
  const t = makeT(p.words);
  const call = useLiveCall(p.tenantId, p.mockLive, p.liveCalls ?? []);
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
    <div data-part="eyebrow" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] uppercase tracking-[0.12em] text-muted">
      <span className="min-w-0 truncate">
        {p.dateLine}
        <span className="max-md:hidden"> · {p.shop}</span>
      </span>
      {call ? (
        <span data-part="on-call" className="inline-flex min-w-0 flex-wrap items-center gap-x-2 border-l border-line pl-3 normal-case tracking-[0.02em] text-red-text max-md:basis-full max-md:border-0 max-md:pl-0">
          <i aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-red-text shadow-[0_0_0_4px_rgba(251,113,133,0.2)]" />
          <span className="min-w-0 truncate">
            {t("tv6.eye.oncall")} · <b className="font-bold text-ink">{call.caller || t("tv6.st.unknown")}</b> · <span className="tabular-nums">{clock(call.seconds)}</span>
          </span>
          <Link href={call.id ? `${p.base}/calls/${call.id}` : `${p.base}/calls`} className="font-bold text-ink underline decoration-[rgba(251,146,60,0.8)] underline-offset-2">
            {t("tv6.st.listen")}
          </Link>
        </span>
      ) : (
        <span data-part="ready" className="inline-flex items-center gap-[7px] border-l border-line pl-3 tracking-[0.04em] text-green-text">
          <i aria-hidden="true" className="size-[7px] rounded-full bg-green-text shadow-[0_0_0_4px_rgba(34,197,94,0.2)]" />
          {t("tv6.st.ready")}
        </span>
      )}
    </div>
      {p.chip || p.demoCall ? (
        <span data-part="eyebrow-chips" className="inline-flex max-w-full flex-wrap items-center gap-2 normal-case tracking-normal max-md:flex-nowrap max-md:whitespace-nowrap">
          {p.chip ? <span data-part="eyebrow-chip">{p.chip}</span> : null}
          {p.demoCall ? <DemoCallButton demoCall={p.demoCall} live={call !== null} t={t} tenantId={p.tenantId} /> : null}
        </span>
      ) : null}
    </div>
  );
}

/** The first press or focus on an orb: the ask machinery wakes (ask-wake.ts) and the live conversation's chunk starts loading. */
const warmOrb = (): void => {
  wakeAsk();
  warmLiveBar();
};

/** The real orb with its halo, tick ring and the glass "Tap to talk" pill under it (desktop). Tapping it turns the composer into the live conversation, in place; the orb follows what the conversation does. */
function BigOrb({ words }: { words: Words }) {
  const t = makeT(words);
  const talking = useTalking();
  const mood = useTalkMood();
  const analyser = useTalkAnalyser();
  const state = mood === "speaking" ? "speak" : mood === "thinking" ? "think" : mood === "listening" ? "listen" : "ambient";
  return (
    <button type="button" data-part="band-orb" onPointerDown={warmOrb} onFocus={warmOrb} onClick={() => {
        // a tap while the assistant speaks cuts it off and it listens; any other tap starts (the microphone is asked for IN this tap) or ends the conversation
        const cut = getTalkBarge();
        if (talking && getTalkMood() === "speaking" && cut) return cut();
        if (!talking) primeAudio();
        setTalking(!talking);
      }} aria-label={t("tv6.tap")} aria-pressed={talking} className="ds-orbz max-md:hidden focus-visible:outline-2">
      <span aria-hidden="true" className="ds-orbz-halo" />
      <span className="ds-orbz-in">
        <OrbRing state={state} size="xl" analyser={analyser} />
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
        <button type="button" data-part="phone-orb" onPointerDown={warmOrb} onFocus={warmOrb} onClick={() => {
        // a tap while the assistant speaks cuts it off and it listens; any other tap starts (the microphone is asked for IN this tap) or ends the conversation
        const cut = getTalkBarge();
        if (talking && getTalkMood() === "speaking" && cut) return cut();
        if (!talking) primeAudio();
        setTalking(!talking);
      }} aria-label={t("tv6.tap")} aria-pressed={talking} className="absolute right-0 top-0 rounded-full md:hidden">
          <OrbRing state="ambient" size="sm" />
        </button>
      </div>
      {p.briefing !== undefined ? p.briefing : <Briefing facts={p.facts ?? { enquiries: null, visits: null }} top={p.top ?? null} waiting={p.waiting ?? null} words={p.words} />}
      {talking && !desktop ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-black/30">
          <LazyLiveBar variant="bar" words={p.words} appLang={p.lang} language={p.language} {...(isVoiceLang(p.businessLang) ? { voiceLanguage: p.businessLang, stt: p.businessLang } : {})} onClose={() => setTalking(false)} />
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
  const mood = useTalkMood();
  const analyser = useTalkAnalyser();
  const { submit } = usePlanSubmit(undefined, () => setText(""));
  const box = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`; // up to four lines, then it scrolls
  }, [text]);
  const release = () => setHeld(false);
  const spoken = CHAT_LANGS.find((l) => l.code === businessLang)?.native ?? language;
  const lightUntil = useLightUntil();
  return (
    <>
      <div aria-hidden="true" className={`${lightUntil ? "h-32" : "h-24"} md:hidden`} />
      <div data-part="phone-bar" data-lang={businessLang ?? ""} className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 bg-bg/95 px-3 pb-2 pt-3 backdrop-blur md:hidden print:hidden">
        <LightNote words={words} until={lightUntil} className="mb-2 ml-2" />
        <form
          data-write
          onPointerDownCapture={wakeAsk}
          onFocusCapture={wakeAsk}
          onKeyDownCapture={wakeAsk}
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="flex min-w-0 items-end gap-2 rounded-xl border border-line bg-surface py-1.5 pl-5 pr-1.5 shadow-[0_10px_30px_var(--ds-glow)]"
        >
          <label htmlFor="phone-ask" className="sr-only">
            {t("tv6.cmd.label")}
          </label>
          <textarea
            id="phone-ask"
            ref={box}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (sendsOnEnter(e)) {
                e.preventDefault();
                if (text.trim() !== "") submit(text);
              }
            }}
            maxLength={500}
            placeholder={t("tv6.ph.tell")}
            autoComplete="off"
            className="max-h-28 min-h-12 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 py-3 text-base leading-6 text-ink outline-none placeholder:text-muted"
          />
          {text.trim() !== "" ? (
            <button type="submit" data-part="phone-send" aria-label={t("tv6.send")} className="grid size-12 shrink-0 place-items-center rounded-md bg-brand text-on-brand">
              <ArrowUp aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          <button
            type="button"
            data-part="hold-to-speak"
            aria-label={t(held ? "tv6.hold.release" : "tv6.hold")}
            aria-pressed={talking}
            onPointerDown={(e) => {
              warmOrb();
              if (e.pointerType === "mouse" && e.button !== 0) return;
              const cut = getTalkBarge();
              if (talking && mood === "speaking" && cut) return cut(); // pressing while it speaks cuts it off
              setHeld(true);
              if (!talking) primeAudio(); // the microphone is asked for IN this press
              setTalking(true);
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerLeave={release}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => {
              if (e.detail === 0) {
                if (!talking) primeAudio();
                setTalking(!talking); // a keyboard or a screen reader: one press opens, the next closes
              }
            }}
            className={`grid size-14 shrink-0 touch-none select-none place-items-center rounded-full bg-charcoal shadow-[0_0_0_5px_var(--ds-glow)] ${held ? "ring-4 ring-brand-edge" : ""}`}
          >
            <Orb px={44} state={talking ? (mood === "speaking" ? "speak" : mood === "thinking" ? "think" : "listen") : held ? "listen" : "ambient"} analyser={talking ? analyser : null} />
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
  const awake = useAskAwake();
  return (
    <div data-part="phone-after" className="flex flex-col gap-4 md:hidden">
      {session && (awake || session.phase !== "idle" || session.earlier.length > 0) ? (
        <div className="empty:hidden">
          <LazyAskAnswer session={session} chips={[]} earlierWord={session.w("ask.earlier")} conversational />
        </div>
      ) : null}
      <PhoneBar words={words} language={language} businessLang={businessLang} />
    </div>
  );
}
