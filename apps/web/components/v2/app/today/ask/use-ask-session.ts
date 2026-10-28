"use client";

import * as React from "react";

import type { ConfirmAction } from "@/lib/api/turns";

import { aiMood, type AiMood } from "../../mark/mood";
import { defaultAutoplay, makeAnswerPlayer, markNoticeSeen, noticeSeen, readAutoplay, saveAutoplay, subscribeStore, type AnswerPlayer } from "./answer-audio";
import { ERROR_CODES, type AskDraft, type AskEvent, type AskSource, type AskTransport, type Availability, type VoiceStatus, type VoiceTransport } from "./ask-types";
import type { AskWords } from "./ask-words";
import { canRecord } from "./recorder";
import { fetchVoiceStatus, makeAskTransport, makeVoiceTransport } from "./transport";
import { useRecorder, type RecorderProblem } from "./use-recorder";
import type { VoicePhase } from "./VoiceMode";
import { useDoIt, type DoItOptions, type Mode, type TaskEntry } from "./use-do-it";

import { MAX_QUESTION } from "./ask-constants";

export { MAX_QUESTION };
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
export type Exchange = { asked: string; heardByVoice: boolean; answer: string; sources: AskSource[]; drafts: AskDraft[]; errorCode: string | null; failed: boolean; /** The router proposed an ACTION: the plan waits for Yes / No (or shows its state). */ plan?: ConfirmAction | null; /** The router asked ONE short question instead of answering. */ clarify?: string | null; /** "Do it" mode: this exchange was a task (or the reason a plan could not be made). */ task: TaskEntry | null };

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
  /** Night 4 (tasks): present only when "Ask Vijaya to do it" is on and the person may make a plan; adds the "Ask | Do it" switch. */
  doIt?: DoItOptions | null;
};

/**
 * The state of the Ask box, in one place (job DQ part 0): the question, the streaming answer, the drafts and sources, the microphone, the spoken answer and the thread of earlier exchanges. The Today card and the floating panel
 * of the other screens are two views of the SAME session (AskProvider makes one per workspace layout), so a question asked on Leads is on Today: one conversation, one Ask API. `AskTeam` makes its own session when there is no provider.
 */
export function useAskSession({ lang, base, words, availability, transport: given, voiceStatus: givenStatus, voiceTransport: givenVoice, doIt: doItOptions }: AskSessionOptions) {
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
  const [extra, setExtra] = React.useState<{ plan?: ConfirmAction; clarify?: string }>({}); // what the router answered with besides text: a plan to confirm, or one short question
  const { plan = null, clarify = null } = extra;
  const convRef = React.useRef<string | null>(null); // the conversation the next message continues (null starts a new one)
  const doIt = useDoIt(doItOptions);
  const [mode, setMode] = React.useState<Mode>("ask");
  const [taskEntry, setTaskEntry] = React.useState<TaskEntry | null>(null);
  const modeRef = React.useRef<Mode>("ask"); // read by a recording that finishes long after the render that started it
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
  React.useEffect(() => {
    current.current = { asked, heardByVoice, answer, sources, drafts, errorCode, failed: phase === "error", task: taskEntry, plan, clarify };
    modeRef.current = doIt ? mode : "ask";
  });
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
    setExtra({});
    setTaskEntry(null);
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
        } else if (e.type === "confirm_action" || e.type === "clarify") {
          setExtra(e.type === "clarify" ? { clarify: e.question } : { plan: e.action });
        } else if (e.type === "error") {
          failed = true;
          const code = typeof e.code === "string" && (ERROR_CODES as readonly string[]).includes(e.code) ? e.code : null;
          setErrorCode(code);
          if (code === "voice_unavailable") setVoiceOff(true); // voice was switched off since the page loaded: the microphone goes away
        } else if (e.type === "done") {
          if (e.conversationId) convRef.current = e.conversationId;
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
        } else if (e.type === "task") {
          doIt?.adopt(e.task);
          setTaskEntry({ id: e.task.id });
        } else if (e.type === "task_error") {
          failed = true;
          setTaskEntry({ error: e.error });
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

  /** "Do it" mode: the instruction becomes a plan. The browser makes the task's id, so a double press or a retry is a replay at the API, never a second task. */
  async function* planEvents(instruction: string, taskId: string, signal: AbortSignal): AsyncGenerator<AskEvent> {
    if (!doIt) return;
    try {
      const got = await doIt.actions.plan(taskId, instruction, null);
      if (signal.aborted) return;
      yield got.ok ? { type: "task", task: got.task } : { type: "task_error", error: got.error };
    } catch {
      if (!signal.aborted) yield { type: "task_error", error: "down" };
    }
    yield { type: "done" };
  }

  /** A recording in "Do it" mode: the voice route hears it (`heard`); once the words are known the rest of that request is dropped and the words become the instruction. */
  async function* planFromVoice(blob: Blob, signal: AbortSignal): AsyncGenerator<AskEvent> {
    if (!doIt || voiceTransport === null) return;
    const inner = new AbortController();
    const link = () => inner.abort();
    signal.addEventListener("abort", link);
    let heard = "";
    try {
      for await (const e of voiceTransport({ audio: blob, lang, speak: false, signal: inner.signal })) {
        if (e.type === "heard") {
          heard = e.text.slice(0, MAX_QUESTION).trim();
          yield e;
          inner.abort();
          break;
        }
        if (e.type === "error") {
          yield e;
          return;
        }
      }
    } catch {
      if (signal.aborted) return;
    } finally {
      signal.removeEventListener("abort", link);
    }
    if (signal.aborted) return;
    if (heard === "") {
      yield { type: "error", code: "voice_no_speech" };
      return;
    }
    yield* planEvents(heard, crypto.randomUUID(), signal);
  }

  const ask = async (raw: string) => {
    const question = raw.trim().slice(0, MAX_QUESTION);
    if (!question) return;
    if (modeRef.current === "do" && doIt) {
      const taskId = crypto.randomUUID();
      await run(question, (signal) => planEvents(question, taskId, signal), false, false);
      return;
    }
    if (transport === null) return;
    await run(question, (signal) => transport({ question, lang, signal, conversationId: convRef.current }), false, false);
  };

  /** A recording is the question. A spoken answer is asked for only when the person wants voice answers played (it is paid for by the same allowance, so it is not made to be thrown away). */
  const askVoice = async (blob: Blob) => {
    if (voiceTransport === null) return;
    if (modeRef.current === "do" && doIt) {
      await run("", (signal) => planFromVoice(blob, signal), true, false);
      return;
    }
    const speak = status.speech && autoplay;
    await run("", (signal) => voiceTransport({ audio: blob, lang, speak, signal }), true, speak);
  };

  /** The conversation panel: a turn that was spoken (the socket's captions) joins the thread like a typed one, and "new conversation" empties it. */
  const addExchange = (x: Exchange) => {
    const before = current.current; // a typed exchange that is still on screen goes first: the thread keeps the order things happened in
    const keep = before && (before.asked !== "" || before.answer !== "") && phase !== "asking";
    setEarlier((list) => [...list, ...(keep ? [before] : []), x].slice(-MAX_EARLIER));
    if (keep) {
      setAsked("");
      setAnswer("");
      setSources([]);
      setDrafts([]);
      setErrorCode(null);
      setPhase("idle");
    }
  };
  /** Starts a fresh conversation, or (with an id and its messages from the history) goes on in an earlier one: the next message continues it. */
  const newChat = (id: string | null = null, thread: Exchange[] = []) => {
    abort.current?.abort();
    dropAudio();
    setEarlier(thread.slice(-MAX_EARLIER));
    setAsked("");
    setAnswer("");
    setSources([]);
    setDrafts([]);
    setErrorCode(null);
    setText("");
    setPhase("idle");
    setExtra({});
    convRef.current = id;
  };
  /** The state of a plan changed (the owner said yes or no, or it expired): the plan on screen and any earlier message that carries it. */
  const setActionStatus = (actionId: string, status: ConfirmAction["status"]) => {
    setExtra((x) => (x.plan && x.plan.actionId === actionId ? { plan: { ...x.plan, status } } : x));
    setEarlier((list) => list.map((x) => (x.plan && x.plan.actionId === actionId ? { ...x, plan: { ...x.plan, status } } : x)));
  };
  const [voiceOrb, setVoiceOrb] = React.useState<"listen" | "think" | "speak" | null>(null); // what the spoken conversation is doing, for the floating circle
  const stop = () => {
    abort.current?.abort();
    player.current?.stop();
    setAudioPending(false);
    setPhase(answer || drafts.length || sources.length ? "done" : "idle");
  };

  /** The Play / Stop button of a spoken answer. */
  const togglePlay = () => (playing ? player.current?.stop() : void player.current?.play());

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
    ask, stop, togglePlay, runs, addExchange, newChat, voiceOrb, setVoiceOrb, plan, clarify, setActionStatus,
    /** What the floating circle does: the spoken conversation's state, else the typed answer's. */
    floatOrb: (voiceOrb ?? (phase === "asking" && !answer ? "think" : playing || phase === "asking" ? "speak" : "ambient")) as "listen" | "think" | "speak" | "ambient",
    asking: phase === "asking",
    /** Night 4 (tasks): "ask" unless "Ask Vijaya to do it" is on for this person; `doIt` carries the actions, the words and the tasks of this thread. */
    mode: doIt ? mode : ("ask" as Mode),
    setMode,
    doIt,
    taskEntry,
  };
}

export type AskSession = ReturnType<typeof useAskSession>;
