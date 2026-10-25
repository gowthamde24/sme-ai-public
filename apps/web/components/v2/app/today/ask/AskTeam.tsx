"use client";

import { ArrowRight, Mic, Send, Square, Volume2, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import { AgentOrb } from "../../mark/AgentOrb";
import { orbStateOf } from "../../mark/AgentMark";
import { useCollapsed } from "../../use-collapsed";
import { aiMood, type AiMood } from "../../mark/mood";
import { defaultAutoplay, makeAnswerPlayer, markNoticeSeen, noticeSeen, readAutoplay, saveAutoplay, subscribeStore, type AnswerPlayer } from "./answer-audio";
import { ERROR_CODES, type AskDraft, type AskEvent, type AskSource, type AskTransport, type Availability, type VoiceStatus, type VoiceTransport } from "./ask-types";
import { AskCapabilities } from "./AskCapabilities";
import type { AskWords } from "./ask-words";
import { useFollowAnswer } from "./use-follow-answer";
import { canRecord, clock } from "./recorder";
import { fetchVoiceStatus, makeAskTransport, makeVoiceTransport } from "./transport";
import { useRecorder, type RecorderProblem } from "./use-recorder";
import { VoiceMode, type VoicePhase } from "./VoiceMode";

const MAX_QUESTION = 500;
const MAX_ANSWER = 8000;
const MAX_SOURCES = 8;
const MAX_DRAFTS = 5;
const MAX_LABEL = 160; // a source label carries an amount or a name; it wraps on the screen, so it is not cut short
const card = "rounded-xl border border-line bg-surface shadow-[var(--v2-shadow)]";
const chip = "inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-base text-ink hover:bg-surface-2 disabled:opacity-50";
const heroChip = "inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50";

/** A link the answer asks for, kept only when it stays inside this workspace: the answer can quote a customer's e-mail, so nothing it contains is followed blindly. */
export function insideWorkspace(href: string, base: string): string | null {
  if (typeof href !== "string" || href.length > 300 || !href.startsWith(base) || /[\\\u0000-\u001f]/.test(href)) return null;
  try {
    const u = new URL(href, "http://workspace.invalid");
    const inside = u.pathname === base || u.pathname.startsWith(`${base}/`);
    if (u.origin !== "http://workspace.invalid" || !inside || u.pathname.includes("//") || u.pathname.split("/").includes("..")) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

const KIND_WORD: Readonly<Record<string, string>> = { quote: "today.kind.quote", followup_draft: "today.kind.followup", reply_draft: "ask.kind.reply", enquiry: "ask.kind.enquiry", store_visit: "ask.kind.visit" };

type Phase = "idle" | "asking" | "done" | "error";
type Problem = RecorderProblem | null;
const PROBLEM_WORD: Readonly<Record<RecorderProblem, string>> = { denied: "ask.mic.denied", nomic: "ask.voice.nomic", short: "ask.voice.short", unsupported: "ask.mic.failed", failed: "ask.mic.failed" };
/** What a failed answer says, by the code the route gave (typed and spoken questions share the first six). */
const ERROR_WORD: Readonly<Record<string, string>> = {
  ai_paused_until: "ask.err.cost", run_limit_reached: "ask.err.limit", forbidden: "ask.err.role", agents_disabled: "office.switchedoff", model_busy: "ask.err.busy", model_not_configured: "ask.err.notset",
  voice_too_long: "ask.voice.toolong", voice_too_short: "ask.voice.short", voice_no_speech: "ask.mic.silent", voice_unavailable: "ask.voice.err.unavailable", voice_failed: "ask.voice.err.failed", network: "ask.voice.err.network",
};
/** A finger held on the microphone this long (ms) is hold-to-talk: letting go sends. A shorter touch is a tap: it starts, and the next tap stops. */
const HOLD_MS = 450;
const NONE: VoiceStatus = { available: false, speech: false };

/**
 * "Ask your team": a question to the Agent OWL, answered from the workspace's own records. The answer streams in as plain text, with the screens it came from as links; anything the agent
 * prepared is shown as a DRAFT card whose "Approve" opens the screen that decides (nothing is approved, sent or recorded from here). The microphone (job BF) records the question in
 * the browser (tap to start and tap to stop, or hold on a phone; at most 60 seconds, with a countdown and a Cancel) and sends the recording to the Agent OWL's voice route: what it heard is shown as the
 * person's own message, then the written answer, and the spoken answer when one was asked for. It is drawn only when the API says voice is on and the browser can record: no dead button.
 * While there is no Agent OWL to ask (it is not built, its switch is off, or the answer stream does not exist yet) the box says so and offers nothing to press.
 */
export function AskTeam({ lang, base, words, availability, transport: given, voiceStatus: givenStatus, voiceTransport: givenVoice, variant = "box", onMood, chips: chipTexts, dock = false }: { lang: string; base: string; words: AskWords; availability: Availability; transport?: AskTransport | null; /** Whether voice is on (tests give it; otherwise the box asks `<base>/ask/voice`). */ voiceStatus?: VoiceStatus | null; /** The recording's transport (tests give it; otherwise `<base>/ask/voice`). */ voiceTransport?: VoiceTransport | null; /** `box`: the card with the owl in its header. `hero`: only the question line, the chips and the answer, for the Agent OWL card of Today (the owl is drawn by the card, which learns the mood from `onMood`). */ variant?: "box" | "hero"; onMood?: (mood: AiMood) => void; /** The suggestion chips, when the caller chooses them (`hero`: three). */ chips?: readonly string[]; /** The dock at the bottom of the other screens (job DN, AskDock.tsx): the same `hero` line, without the "What can it do?" card under it. */ dock?: boolean }) {
  const w = (key: string) => words[key] ?? key;
  const own = React.useMemo(() => (availability === "live" && given === undefined ? makeAskTransport(`${base}/ask`) : null), [availability, given, base]);
  const transport = given === undefined ? own : given;
  const [text, setText] = React.useState("");
  const [asked, setAsked] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [answer, setAnswer] = React.useState("");
  const [runs, setRuns] = React.useState(0); // how many questions were asked: a new one makes the page follow the answer again (use-follow-answer.ts)
  const [sources, setSources] = React.useState<AskSource[]>([]);
  const [drafts, setDrafts] = React.useState<AskDraft[]>([]);
  const [problem, setProblem] = React.useState<Problem>(null);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false); // voice mode (job DM): the full-screen circle over the box, opened by the microphone
  const [menuCollapsed] = useCollapsed(); // the menu beside the page decides where the bottom bar starts on a laptop
  const abort = React.useRef<AbortController | null>(null);
  const player = React.useRef<AnswerPlayer | null>(null);
  const [heardByVoice, setHeardByVoice] = React.useState(false);
  const [hasAudio, setHasAudio] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [audioPending, setAudioPending] = React.useState(false);
  const [audioFailed, setAudioFailed] = React.useState(false);
  // the saved choices; before the page has read them the privacy line is shown (never hidden by a guess) and auto-play is off
  const savedAutoplay = React.useSyncExternalStore(subscribeStore, () => readAutoplay() ?? defaultAutoplay(), () => false);
  const [chosenAutoplay, setChosenAutoplay] = React.useState<boolean | null>(null); // this page's own choice (kept even if the browser will not store it)
  const autoplay = chosenAutoplay ?? savedAutoplay;
  const savedSeen = React.useSyncExternalStore(subscribeStore, noticeSeen, () => false);
  const [sentOne, setSentOne] = React.useState(false);
  const seen = savedSeen || sentOne;
  const held = React.useRef<number | null>(null);
  const byPointer = React.useRef(false);
  const [fetchedStatus, setFetchedStatus] = React.useState<VoiceStatus | null>(null);
  const [voiceOff, setVoiceOff] = React.useState(false);
  const canRecordHere = React.useSyncExternalStore(
    () => () => {},
    () => canRecord(),
    () => false,
  );
  const live = availability === "live" && transport !== null;
  // before any early return below: a hook is always called (use-follow-answer.ts)
  const answerRef = useFollowAnswer(runs, phase === "asking", `${answer.length}|${sources.length}|${drafts.length}|${phase}`);
  const voiceEndpoint = `${base}/ask/voice`;
  const ownVoice = React.useMemo(() => (givenVoice === undefined && givenStatus === undefined ? makeVoiceTransport(voiceEndpoint) : null), [givenVoice, givenStatus, voiceEndpoint]);
  const voiceTransport = givenVoice === undefined ? ownVoice : givenVoice;
  const status = voiceOff ? NONE : givenStatus !== undefined ? (givenStatus ?? NONE) : (fetchedStatus ?? NONE);
  const showMic = live && status.available && voiceTransport !== null && canRecordHere;

  React.useEffect(() => {
    if (!live || givenStatus !== undefined || !canRecordHere) return;
    const controller = new AbortController();
    void fetchVoiceStatus(voiceEndpoint, controller.signal).then((s) => {
      if (!controller.signal.aborted) setFetchedStatus(s);
    });
    return () => controller.abort();
  }, [live, givenStatus, canRecordHere, voiceEndpoint]);
  const setAutoplay = (on: boolean) => {
    setChosenAutoplay(on);
    saveAutoplay(on);
    if (!on) player.current?.stop();
  };
  const dropAudio = () => {
    player.current?.dispose();
    player.current = null;
    setHasAudio(false);
    setPlaying(false);
    setAudioPending(false);
    setAudioFailed(false);
  };

  const recorder = useRecorder({
    onRecorded: (blob) => {
      markNoticeSeen();
      setSentOne(true);
      void askVoice(blob);
    },
    onProblem: (p) => setProblem(p),
  });
  const recording = recorder.state !== "idle";
  React.useEffect(
    () => () => {
      abort.current?.abort();
      player.current?.dispose();
    },
    [],
  );
  React.useEffect(() => {
    if (recorder.state !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        recorder.cancel();
        setVoiceOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recorder]);
  React.useEffect(() => {
    if (!voiceOpen || recorder.state !== "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVoiceOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voiceOpen, recorder.state]);

  const mood = aiMood({ live, typing: focused && text.trim() !== "", micOn: recording, speaking: playing, phase, hasText: answer !== "", errorCode });
  React.useEffect(() => {
    onMood?.(mood);
  }, [mood, onMood]);
  const hero = variant === "hero";
  const title = hero ? null : (
    <div className="flex items-center gap-3 sm:gap-4">
      <AgentOrb mood={mood} name={w("agent.main")} moodText={w(`owl.mood.${mood}`)} />
      <div className="min-w-0">
        <h2 id="ask-heading" className="font-display text-xl font-semibold leading-tight">
          {w("ask.title")}
        </h2>
        <p className="text-sm text-muted">{live ? w("ask.sub") : availability === "switched_off" ? w("office.switchedoff") : w("frame.notyet")}</p>
      </div>
    </div>
  );
  if (!live || transport === null) {
    if (hero)
      return (
        <p data-ask="unavailable" className="text-base text-muted">
          {availability === "switched_off" ? w("office.switchedoff") : w("frame.notyet")}
        </p>
      );
    return (
      <section aria-labelledby="ask-heading" data-ask="unavailable" className={`${card} mx-auto mb-8 max-w-3xl p-4 sm:p-5`}>
        {title}
      </section>
    );
  }

  /** Runs one question: `source` makes the events (typed: the text transport; spoken: the recording's transport). The same screen draws both. */
  const run = async (question: string, source: (signal: AbortSignal) => AsyncIterable<AskEvent>, voice: boolean, speak: boolean) => {
    abort.current?.abort();
    recorder.cancel();
    dropAudio();
    const controller = new AbortController();
    abort.current = controller;
    setRuns((n) => n + 1);
    setAsked(question);
    setHeardByVoice(voice);
    setText("");
    setProblem(null);
    setPhase("asking");
    setErrorCode(null);
    setAnswer("");
    setSources([]);
    setDrafts([]);
    setAudioPending(voice && speak);
    let failed = false;
    try {
      for await (const e of source(controller.signal)) {
        if (controller.signal.aborted) return;
        if (e.type === "heard") setAsked(e.text.slice(0, MAX_QUESTION));
        else if (e.type === "text" && typeof e.delta === "string") setAnswer((a) => (a + e.delta).slice(0, MAX_ANSWER));
        else if (e.type === "source") {
          const href = e.href === null ? null : insideWorkspace(e.href, base);
          if (typeof e.label === "string" && (href !== null || e.href === null)) {
            const label = e.label.slice(0, MAX_LABEL);
            setSources((s) => (s.length >= MAX_SOURCES || s.some((x) => x.href === href && x.label === label) ? s : [...s, { label, href }]));
          }
        } else if (e.type === "draft") {
          const href = e.href === null ? null : insideWorkspace(e.href, base);
          if (href !== null || e.href === null)
            setDrafts((d) =>
              d.length >= MAX_DRAFTS || d.some((x) => x.id === e.id)
                ? d
                : [...d, { id: String(e.id).slice(0, 64), kind: String(e.kind), title: String(e.title).slice(0, 120), summary: String(e.summary).slice(0, 400), href, language: typeof e.language === "string" ? e.language.slice(0, 8) : null, gloss: typeof e.gloss === "string" ? e.gloss.slice(0, 400) : null, machine: e.machine === true }],
            );
        } else if (e.type === "error") {
          failed = true;
          const code = typeof e.code === "string" && (ERROR_CODES as readonly string[]).includes(e.code) ? e.code : null;
          setErrorCode(code);
          if (code === "voice_unavailable") setVoiceOff(true); // voice was switched off since the page loaded: the microphone goes away
        } else if (e.type === "done") {
          if (!failed) setPhase("done"); // the written answer is whole; a spoken one may still follow
        } else if (e.type === "audio") {
          player.current?.dispose();
          const p = makeAnswerPlayer(e.contentType, e.data, setPlaying);
          player.current = p;
          setAudioPending(false);
          if (p === null) setAudioFailed(true);
          else {
            setHasAudio(true);
            if (speak) void p.play(); // a browser that will not start sound by itself leaves the Play button
          }
        } else if (e.type === "audio_error") {
          setAudioPending(false);
          setAudioFailed(true);
        }
      }
    } catch {
      if (controller.signal.aborted) return;
      failed = true;
    }
    if (!controller.signal.aborted) {
      setAudioPending(false);
      setPhase(failed ? "error" : "done");
    }
  };

  const ask = async (raw: string) => {
    const question = raw.trim().slice(0, MAX_QUESTION);
    if (!question || transport === null) return;
    await run(question, (signal) => transport({ question, lang, signal }), false, false);
  };

  /** A recording is the question. A spoken answer is asked for only when the person wants voice answers played (it is paid for by the same allowance, so it is not made to be thrown away). */
  const askVoice = async (blob: Blob) => {
    if (voiceTransport === null) return;
    const speak = status.speech && autoplay;
    await run("", (signal) => voiceTransport({ audio: blob, lang, speak, signal }), true, speak);
  };

  const stop = () => {
    abort.current?.abort();
    player.current?.stop();
    setAudioPending(false);
    setPhase(answer || drafts.length || sources.length ? "done" : "idle");
  };

  const startVoice = () => {
    abort.current?.abort(); // a new question ends the old answer
    player.current?.stop();
    setProblem(null);
    setVoiceOpen(true);
    void recorder.start();
  };
  // A finger held on the microphone is hold-to-talk (let go to send); a quick tap starts, and the next tap stops. A mouse or the keyboard always taps (click).
  const micDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    byPointer.current = true;
    if (recorder.state === "recording") {
      held.current = null;
      recorder.stop();
    } else if (recorder.state === "idle") {
      held.current = Date.now();
      startVoice();
    }
  };
  const micUp = () => {
    const since = held.current;
    held.current = null;
    if (since !== null && recorder.state === "recording" && Date.now() - since >= HOLD_MS) recorder.stop();
  };
  const micClick = () => {
    if (byPointer.current) {
      byPointer.current = false; // the touch already did it
      return;
    }
    if (recorder.state === "recording") recorder.stop();
    else if (recorder.state === "idle") startVoice();
  };

  // voice mode: what it shows follows the recorder (listening), the request (thinking) and the answer (its last words, while it streams and when it is read out)
  const voicePhase: VoicePhase = recorder.state === "starting" ? "starting" : recorder.state === "recording" ? "listening" : phase === "asking" ? (answer ? "answering" : "thinking") : playing ? "answering" : phase === "error" || problem ? "error" : "done";
  const voiceCaption = problem || phase === "error" ? w("ask.voice.mode.problem") : "";
  const chips = chipTexts ?? [w("ask.chip.needs"), w("ask.chip.quotes"), w("ask.chip.money"), w("ask.chip.team")];
  const asking = phase === "asking";
  const Shell = hero ? "div" : "section";
  const shellProps = hero ? { "data-ask": "live" } : { "aria-labelledby": "ask-heading", "data-ask": "live", className: `${card} mx-auto mb-8 max-w-3xl p-4 sm:p-5` };
  // hero: on a phone the question line is fixed above the bottom bar (64 px and the safe area), on a laptop it sits in the card
  // job DM: the question line is a bar at the BOTTOM of the screen on every size: above the bottom bar on a phone, floating over the page from the edge of the menu on a laptop (the page keeps room for it)
  const heroBar = "flex items-center gap-2 fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-bg px-4 py-2.5 md:inset-x-auto md:right-6 md:bottom-4 md:rounded-[18px] md:border md:bg-surface md:px-3 md:py-2 md:shadow-[0_10px_30px_rgba(30,30,36,0.08)]";
  const formClass = hero ? `${heroBar} ${menuCollapsed ? "md:left-[calc(72px+1.5rem)]" : "md:left-[calc(16rem+1.5rem)]"}` : "mt-4 flex items-stretch gap-2";
  const inputClass = hero
    ? "min-h-12 min-w-0 flex-1 rounded-full border border-edge bg-bg px-5 text-base text-ink placeholder:text-muted focus:border-brand-edge md:min-h-14 md:bg-bg"
    : "min-h-12 min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-brand-edge";
  const round = hero ? "rounded-full size-12 md:size-14" : "rounded-lg size-12";
  return (
    <Shell {...shellProps}>
      {title}
      <form
        data-write
        className={formClass}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        {hero ? <Orb px={32} state={orbStateOf(mood)} /> : null}
        <label htmlFor="ask-input" className="sr-only">
          {w("ask.label")}
        </label>
        {recording ? (
          <div data-voice="recording" className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 border border-brand-edge bg-bg px-4 text-base text-ink ${hero ? "rounded-full md:min-h-14" : "rounded-lg"}`}>
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-red-text motion-safe:animate-pulse" />
            <span className="max-sm:sr-only font-semibold">{recorder.state === "starting" ? w("ask.voice.starting") : w("ask.listening")}</span>
            {recorder.state === "recording" ? (
              <span data-voice="countdown" className="ml-auto whitespace-nowrap tabular-nums">
                {w("ask.voice.left").replace("{time}", clock(recorder.left))}
              </span>
            ) : null}
          </div>
        ) : (
          <input
            id="ask-input"
            value={text}
            maxLength={MAX_QUESTION}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={hero ? w("ask.placeholder.hero") : w("ask.placeholder")}
            autoComplete="off"
            className={inputClass}
          />
        )}
        {showMic ? (
          <button
            type="button"
            onClick={micClick}
            onPointerDown={micDown}
            onPointerUp={micUp}
            onPointerCancel={micUp}
            onContextMenu={(e) => e.preventDefault()}
            aria-pressed={recording}
            aria-label={recording ? w("ask.mic.stop") : w("ask.mic")}
            title={recording ? w("ask.mic.stop") : w("ask.mic")}
            data-voice="mic"
            className={`inline-flex ${round} shrink-0 touch-none select-none items-center justify-center border ${recording || hero ? "border-brand-edge bg-brand text-on-brand" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}
          >
            {recording ? <Square className="size-5" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>
        ) : null}
        {/* Cancel takes the place of Ask: the microphone must not move when recording starts, or the tap that started it would land on Cancel */}
        {recording ? (
          <button type="button" onClick={() => recorder.cancel()} aria-label={w("ask.voice.cancel")} title={w("ask.voice.cancel")} className={`inline-flex ${round} shrink-0 items-center justify-center border border-edge bg-surface text-ink hover:bg-surface-2 sm:w-auto sm:gap-2 sm:px-4`}>
            <X className="size-5" aria-hidden="true" />
            <span className="max-sm:sr-only text-base font-semibold">{w("ask.voice.cancel")}</span>
          </button>
        ) : null}
        {recording ? null : asking ? (
          <button type="button" onClick={stop} className={`inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 border border-edge bg-surface text-base font-semibold text-ink hover:bg-surface-2 ${hero ? "rounded-full md:size-14" : "rounded-lg px-3 sm:px-4"}`}>
            <Square className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{w("ask.stop")}</span>
          </button>
        ) : (
          <button type="submit" disabled={text.trim() === ""} className={`inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 border text-base font-semibold hover:brightness-95 disabled:opacity-50 ${hero ? "size-12 rounded-full border-edge bg-surface text-ink md:size-14" : "rounded-lg border-brand-edge bg-brand px-3 text-on-brand sm:px-4"}`}>
            <Send className={hero ? "size-5" : "size-4"} aria-hidden="true" />
            <span className={hero ? "sr-only" : "sr-only sm:not-sr-only"}>{w("ask.send")}</span>
          </button>
        )}
      </form>
      {recording ? (
        <p role="status" className="sr-only">
          {recorder.state === "recording" ? w("ask.voice.recording.sr").replace("{s}", String(recorder.left <= 10 ? Math.ceil(recorder.left / 5) * 5 : 60)) : ""}
        </p>
      ) : null}
      {showMic && !seen ? (
        <p data-voice="privacy" className="mt-2 text-sm text-muted">
          {w("ask.mic.privacy")} {w("ask.voice.hint")}
        </p>
      ) : null}
      {showMic && status.speech ? (
        <button type="button" role="switch" aria-checked={autoplay} onClick={() => setAutoplay(!autoplay)} data-voice="autoplay" className="mt-2 inline-flex min-h-11 items-center gap-3 rounded-lg pr-2 text-sm text-ink">
          <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border ${autoplay ? "border-brand-edge bg-brand" : "border-edge bg-surface-2"}`}>
            <span className={`absolute size-4 rounded-full bg-on-brand shadow ${autoplay ? "left-6" : "left-1 bg-muted"}`} />
          </span>
          {w("ask.voice.autoplay")}
        </button>
      ) : null}
      {problem ? (
        <p role="status" className="mt-2 text-sm text-amber-text">
          {w(PROBLEM_WORD[problem])}
        </p>
      ) : null}
      {phase === "idle" ? (
        <ul className={`mt-3 flex flex-wrap gap-2 ${hero ? "max-md:hidden" : ""}`} aria-label={w("ask.title")}>
          {chips.map((c) => (
            <li key={c}>
              <button type="button" onClick={() => void ask(c)} className={hero ? heroChip : chip}>
                {c}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {dock ? null : <AskCapabilities w={w} examples={[w("ask.chip.needs"), w("ask.chip.quotes"), w("ask.chip.team")]} onTry={(q) => void ask(q)} guideHref={`${base}/help/today`} />}

      {phase !== "idle" ? (
        <div ref={answerRef} className="mt-4 border-t border-line pt-4" aria-live="polite" aria-busy={asking}>
          <p className="text-sm text-muted">{asked ? `${w(heardByVoice ? "ask.voice.said" : "ask.asked")} ${asked}` : heardByVoice ? w("ask.voice.working") : ""}</p>
          {answer ? <p className="mt-2 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{answer}</p> : asking ? <p className="mt-2 text-base text-muted">{w("ask.thinking")}</p> : null}
          {hasAudio ? (
            <button type="button" data-voice="play" onClick={() => (playing ? player.current?.stop() : void player.current?.play())} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2">
              {playing ? <Square className="size-4" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
              {playing ? w("ask.stop") : w("ask.voice.play")}
            </button>
          ) : null}
          {audioPending ? <p className="mt-2 text-sm text-muted">{w("ask.voice.speaking")}</p> : null}
          {audioFailed ? <p className="mt-2 text-sm text-muted">{w("ask.voice.audioerr")}</p> : null}
          {phase === "error" ? (
            <p role="alert" className="mt-2 text-base font-medium text-red-text">
              {errorCode !== null && ERROR_WORD[errorCode] ? w(ERROR_WORD[errorCode]) : w("ask.error")}
            </p>
          ) : null}
          {sources.length ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">{w("ask.sources")}</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {sources.map((s, i) => (
                  <li key={`${s.href ?? "-"}-${i}`} className="max-w-full min-w-0">
                    {s.href ? (
                      <Link href={s.href} prefetch={false} className="inline-flex min-h-11 max-w-full items-center rounded-lg border border-edge bg-surface px-3 py-2 text-sm font-medium text-ink [overflow-wrap:anywhere] hover:bg-surface-2">
                        {s.label}
                      </Link>
                    ) : (
                      <span className="inline-flex min-h-11 max-w-full items-center rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-muted [overflow-wrap:anywhere]">{s.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {drafts.length ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">{w("ask.drafts")}</h3>
              <ul className="mt-2 space-y-3">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <article aria-label={d.title} className="rounded-lg border border-line bg-surface-2 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md border border-edge bg-surface px-2 py-0.5 text-sm font-semibold">{w("today.state.draft")}</span>
                        <span className="text-sm font-medium text-muted">{KIND_WORD[d.kind] ? w(KIND_WORD[d.kind]) : ""}</span>
                        {d.machine ? <span className="text-sm font-medium text-muted">{w("ask.machine")}</span> : null}
                      </div>
                      <h4 className="mt-2 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{d.title}</h4>
                      <p lang={d.language ?? undefined} className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{d.summary}</p>
                      {d.gloss ? (
                        <p className="mt-2 border-l-2 border-edge pl-3 text-base text-muted [overflow-wrap:anywhere]">
                          <span className="font-semibold">{w("ask.gloss")}</span> {d.gloss}
                        </p>
                      ) : null}
                      {d.href ? (
                        <>
                          <Link href={d.href} prefetch={false} className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-lg border border-brand-edge bg-brand px-5 text-base font-semibold text-on-brand hover:brightness-95">
                            {w("ask.approve")}
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </Link>
                          <p className="mt-2 text-sm text-muted">{w("ask.approve.hint")}</p>
                        </>
                      ) : (
                        <p className="mt-3 text-sm text-muted">{w("ask.noscreen")}</p>
                      )}
                    </article>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {phase !== "asking" ? (
            <ul className={`mt-4 flex flex-wrap gap-2 ${hero ? "max-md:hidden" : ""}`} aria-label={w("ask.title")}>
              {chips.map((c) => (
                <li key={c}>
                  <button type="button" onClick={() => void ask(c)} className={hero ? heroChip : chip}>
                    {c}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {voiceOpen ? (
        <VoiceMode
          phase={voicePhase}
          caption={voiceCaption}
          left={recorder.state === "recording" ? recorder.left : null}
          words={{ title: w("ask.voice.mode"), listening: w("ask.voice.mode.listening"), starting: w("ask.voice.mode.starting"), thinking: w("ask.voice.mode.thinking"), speaking: w("ask.voice.mode.answering"), done: w("ask.voice.done"), show: w("ask.voice.show"), cancel: w("ask.voice.mode.cancel"), tap: w("ask.voice.tap"), close: w("ask.voice.close") }}
          onTapOrb={() => (recorder.state === "recording" ? recorder.stop() : recorder.state === "idle" ? startVoice() : undefined)}
          onDone={() => recorder.stop()}
          onCancel={() => {
            recorder.cancel();
            setVoiceOpen(false);
          }}
          onClose={() => {
            if (recorder.state !== "idle") recorder.cancel();
            setVoiceOpen(false);
          }}
        />
      ) : null}
    </Shell>
  );
}
