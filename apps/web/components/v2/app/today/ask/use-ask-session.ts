"use client";

import * as React from "react";

import { aiMood, type AiMood } from "../../mark/mood";
import { defaultAutoplay, makeAnswerPlayer, markNoticeSeen, noticeSeen, readAutoplay, saveAutoplay, subscribeStore, type AnswerPlayer } from "./answer-audio";
import { ERROR_CODES, type AskDraft, type AskEvent, type AskSource, type AskTransport, type Availability, type VoiceStatus, type VoiceTransport } from "./ask-types";
import type { AskWords } from "./ask-words";
import { canRecord } from "./recorder";
import { fetchVoiceStatus, makeAskTransport, makeVoiceTransport } from "./transport";
import { useFollowAnswer } from "./use-follow-answer";
import { useRecorder, type RecorderProblem } from "./use-recorder";
import type { VoicePhase } from "./VoiceMode";

export const MAX_QUESTION = 500;
const MAX_ANSWER = 8000;
const MAX_SOURCES = 8;
const MAX_DRAFTS = 5;
const MAX_LABEL = 160; // a source label carries an amount or a name; it wraps on the screen, so it is not cut short
/** How many earlier exchanges the thread keeps (the page holds them in memory only: nothing of an answer is stored in the browser). */
export const MAX_EARLIER = 20;
/** A finger held on the microphone this long (ms) is hold-to-talk: letting go sends. A shorter touch is a tap: it starts, and the next tap stops. */
const HOLD_MS = 450;
const NONE: VoiceStatus = { available: false, speech: false };

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

export type AskPhase = "idle" | "asking" | "done" | "error";
export type AskProblem = RecorderProblem | null;
/** One question and its answer, as the thread keeps it. */
export type Exchange = { asked: string; heardByVoice: boolean; answer: string; sources: AskSource[]; drafts: AskDraft[]; errorCode: string | null; failed: boolean };

export type AskSessionOptions = {
  lang: string;
  base: string;
  words: AskWords;
  availability: Availability;
  transport?: AskTransport | null;
  /** Whether voice is on (tests give it; otherwise the session asks `<base>/ask/voice`). */
  voiceStatus?: VoiceStatus | null;
  /** The recording's transport (tests give it; otherwise `<base>/ask/voice`). */
  voiceTransport?: VoiceTransport | null;
};

/**
 * The state of the Ask box, in one place (job DQ part 0): the question, the streaming answer, the drafts and sources, the microphone, the spoken answer and the thread of earlier exchanges. The Today card and the floating panel
 * of the other screens are two views of the SAME session (AskProvider makes one per workspace layout), so a question asked on Leads is on Today: one conversation, one Ask API. `AskTeam` makes its own session when there is no provider.
 */
export function useAskSession({ lang, base, words, availability, transport: given, voiceStatus: givenStatus, voiceTransport: givenVoice }: AskSessionOptions) {
  const w = React.useCallback((key: string) => words[key] ?? key, [words]);
  const own = React.useMemo(() => (availability === "live" && given === undefined ? makeAskTransport(`${base}/ask`) : null), [availability, given, base]);
  const transport = given === undefined ? own : given;
  const [text, setText] = React.useState("");
  const [asked, setAsked] = React.useState("");
  const [phase, setPhase] = React.useState<AskPhase>("idle");
  const [answer, setAnswer] = React.useState("");
  const [runs, setRuns] = React.useState(0); // how many questions were asked: a new one makes the page follow the answer again (use-follow-answer.ts)
  const [sources, setSources] = React.useState<AskSource[]>([]);
  const [drafts, setDrafts] = React.useState<AskDraft[]>([]);
  const [problem, setProblem] = React.useState<AskProblem>(null);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [focused, setFocused] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false); // voice mode (job DM): the full-screen circle over the box, opened by the microphone
  const [earlier, setEarlier] = React.useState<Exchange[]>([]);
  const [finished, setFinished] = React.useState(0); // how many answers have finished: the floating orb shows a dot for one the person has not seen
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
  // the exchange on screen, readable from a handler made by an earlier render (a recording finishes long after the render that started it)
  const current = React.useRef<Exchange | null>(null);
  current.current = { asked, heardByVoice, answer, sources, drafts, errorCode, failed: phase === "error" };
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

  const mood: AiMood = aiMood({ live, typing: focused && text.trim() !== "", micOn: recording, speaking: playing, phase, hasText: answer !== "", errorCode });

  /** Runs one question: `source` makes the events (typed: the text transport; spoken: the recording's transport). Every view draws both the same. */
  const run = async (question: string, source: (signal: AbortSignal) => AsyncIterable<AskEvent>, voice: boolean, speak: boolean) => {
    abort.current?.abort();
    recorder.cancel();
    dropAudio();
    const controller = new AbortController();
    abort.current = controller;
    // the exchange that was on screen joins the thread (a question that was never answered is not kept)
    const before = current.current;
    if (before && (before.asked !== "" || before.answer !== "")) setEarlier((list) => [...list, before].slice(-MAX_EARLIER));
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
      setFinished((n) => n + 1);
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

  return {
    w, lang, base, words, availability, live, transport,
    text, setText, focused, setFocused, asked, phase, answer, sources, drafts, problem, errorCode, heardByVoice, earlier, finished, mood,
    hasAudio, playing, audioPending, audioFailed, autoplay, setAutoplay, seen, showMic, status,
    recorder, recording, voiceOpen, setVoiceOpen, voicePhase, startVoice, micClick, micDown, micUp,
    ask, stop, answerRef, player,
    asking: phase === "asking",
  };
}

export type AskSession = ReturnType<typeof useAskSession>;
