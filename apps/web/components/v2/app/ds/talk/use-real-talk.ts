"use client";

import * as React from "react";

import type { ActionStatus, ConfirmAction } from "@/lib/api/turns";
import { browserAudio } from "@/lib/browser-voice/audio-io";
import { VoiceClient, type AudioIO, type Snapshot, type SocketLike } from "@/lib/browser-voice/client";
import type { EndWord, VoiceLang } from "@/lib/browser-voice/protocol";
import { askVoiceToken } from "@/lib/browser-voice/token";
import { formatRupeesShort } from "@/lib/money";

import type { BrowserVoice } from "../../today/ask/browser-voice";
import { confirmPlan } from "../../today/ask/conversation-api";
import type { TalkLine, TalkPlan, TalkState } from "./script";
import type { TalkLive, TalkProblem } from "./use-talk-live";

export type RealTalkOptions = {
  voice: BrowserVoice | null;
  /** `/app/tenants/<id>`: where the plan's Yes / No is sent. Absent: taken from the address of the page. */
  base?: string | null;
  /** What the assistant answers and speaks in, and what the recogniser is pinned to (the composer's language); default: the app's language, detecting. */
  language?: VoiceLang;
  stt?: VoiceLang | null;
  audioFactory?: () => AudioIO;
  socketFactory?: (url: string) => SocketLike;
  confirm?: typeof confirmPlan;
};

/** Nobody speaks for this long while it listens: it ends by itself (the same as the chat panel's live talk). */
export const REAL_SILENCE_MS = 30_000;
/** After this much quiet while it listens, one gentle "Still there?". */
export const REAL_CHECKIN_MS = 8_000;
/** The notice "ends in n seconds" shows for the last this many seconds of the conversation. */
export const REAL_WARN_S = 120;
/** The API has this long to say "ready" after the socket opens, else the bar says "Couldn't connect". */
export const REAL_CONNECT_MS = 12_000;
const TOKEN_FRESH_MS = 20 * 60_000;
/** These end words are normal ends: the bar just goes back (the person said bye, or closed it). */
const QUIET_END: readonly EndWord[] = ["left", "goodbye"];
/** After these the same button can try again (a wait, a busy line, a dropped line, a time limit); the others need a change that "Try again" cannot make. */
const RETRY_END: readonly EndWord[] = ["unavailable", "busy", "rate", "session", "idle"];

const STATE: Record<string, TalkState> = { listening: "listening", paused: "listening", thinking: "thinking", speaking: "speaking" };

/** The API's plan, as the card draws it: its title and summary, and only the numbers it gave (never calling hours: the plan has none). */
export function planOf(a: ConfirmAction): TalkPlan {
  return { what: a.title, summary: a.summary, time: "", hours: "", cost: a.estimate && a.estimate.costPaise > 0 ? formatRupeesShort(a.estimate.costPaise) : "", people: a.count, messages: a.estimate ? a.estimate.messages : null, minutes: a.estimate && a.estimate.callMinutes > 0 ? a.estimate.callMinutes : null, channel: a.channel };
}

const baseOfPage = (): string | null => /^\/app\/tenants\/[0-9a-f-]{36}/i.exec(window.location.pathname)?.[0] ?? null;

/**
 * "Talk live" with the REAL voice (design system v6, owner 13 Nov 2026): the same shape as the made-up conversation, driven by the browser voice socket (lib/browser-voice: the person's microphone only while the assistant listens, the assistant's voice played as it arrives, barge-in).
 * The microphone is asked for by `primeAudio()` in the tap itself; this hook opens the socket as soon as the bar is drawn. A reason to stop that the person did not choose is a `problem` the bar says in words (never silence): "Couldn't connect · Try again".
 * Mute really turns the microphone's track off and sends nothing. Everything idle until `start()`; with no `voice` (flag off, a test) it stays idle and the made-up conversation is used instead.
 */
export function useRealTalk(voice: BrowserVoice | null, o: Omit<RealTalkOptions, "voice"> = {}): TalkLive {
  // what `start` and `decide` read is kept in a ref: their identity must not change with every render (the live bar starts in an effect that depends on `start`)
  const opts = React.useRef({ voice, o });
  React.useEffect(() => {
    opts.current = { voice, o };
  });
  const [active, setActive] = React.useState(false);
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [problem, setProblem] = React.useState<TalkProblem | null>(null);
  const [finished, setFinished] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [muted, setMuted] = React.useState(false);
  const [decided, setDecided] = React.useState<{ id: string; status: ActionStatus } | null>(null);
  const [planBusy, setPlanBusy] = React.useState(false);
  const [planError, setPlanError] = React.useState<string | null>(null);
  const [clock, setClock] = React.useState<{ quietMs: number; left: number | null }>({ quietMs: 0, left: null });
  const client = React.useRef<VoiceClient | null>(null);
  const audio = React.useRef<AudioIO | null>(null);
  const [io, setIo] = React.useState<AudioIO | null>(null); // the same audio, for what the screen reads (the loudness): a ref cannot be read while drawing
  const token = React.useRef<{ value: string; at: number } | null>(null);
  const mutedRef = React.useRef(false);
  const timedOut = React.useRef(false);
  const connectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = React.useRef(0);
  const starting = React.useRef(false);
  const tokenUrl = voice?.tokenUrl ?? null;

  // the sign-in for the socket's first message is asked for before the tap when it can be, so the tap is fast
  React.useEffect(() => {
    if (!tokenUrl) return;
    let alive = true;
    void askVoiceToken(tokenUrl).then((out) => {
      if (alive && out.ok) token.current = { value: out.token, at: Date.now() };
    });
    return () => {
      alive = false;
    };
  }, [tokenUrl]);

  const clearConnect = () => {
    if (connectTimer.current) clearTimeout(connectTimer.current);
    connectTimer.current = null;
  };
  const reset = React.useCallback(() => {
    clearConnect();
    setActive(false);
    setSnap(null);
    setProblem(null);
    setFinished(false);
    setSeconds(0);
    setMuted(false);
    mutedRef.current = false;
    setDecided(null);
    setPlanBusy(false);
    setPlanError(null);
    setClock({ quietMs: 0, left: null });
  }, []);
  const end = React.useCallback(() => {
    runId.current++; // events of the closed conversation are ignored
    starting.current = false;
    const c = client.current;
    client.current = null;
    c?.stop();
    audio.current?.close();
    audio.current = null;
    setIo(null);
    reset();
  }, [reset]);
  React.useEffect(() => end, [end]); // the page goes away: the microphone goes off

  /** A conversation that stopped by itself: what to tell the person. */
  const explain = (s: Snapshot): TalkProblem | null => {
    if (s.micDenied) return { kind: "mic", word: null, retry: true };
    const word = s.end ?? "unavailable";
    if (timedOut.current) return { kind: "connect", word: null, retry: true };
    if (QUIET_END.includes(word) && s.readyAt !== null) return null;
    if (s.readyAt === null) return word === "signin" || word === "refused" || word === "gone" ? { kind: "end", word, retry: false } : { kind: "connect", word: null, retry: true };
    if (word === "unavailable") return { kind: "lost", word, retry: true };
    return { kind: "end", word, retry: RETRY_END.includes(word) };
  };

  const start = React.useCallback(async () => {
    const { voice, o } = opts.current;
    if (!voice || client.current || starting.current) return;
    const { audioFactory = browserAudio, socketFactory = (u: string) => new WebSocket(u) as unknown as SocketLike } = o;
    starting.current = true;
    const run = ++runId.current;
    timedOut.current = false;
    reset();
    setActive(true);
    if (token.current === null || Date.now() - token.current.at > TOKEN_FRESH_MS) {
      const out = await askVoiceToken(voice.tokenUrl);
      if (run !== runId.current) return;
      if (!out.ok) {
        starting.current = false;
        setProblem({ kind: "connect", word: null, retry: true });
        return;
      }
      token.current = { value: out.token, at: Date.now() };
    }
    const real = audioFactory();
    // Mute: the microphone track is turned off AND any frame that still arrives is dropped here
    const wrapped: AudioIO = { ...real, startMic: (onFrame) => real.startMic((pcm, level) => (mutedRef.current ? undefined : onFrame(pcm, level))) };
    audio.current = wrapped;
    setIo(wrapped);
    const c: VoiceClient = new VoiceClient({
      url: voice.url,
      token: token.current.value,
      language: o.language ?? voice.language,
      sttLanguage: o.stt ?? null,
      audio: wrapped,
      socket: socketFactory,
      onChange: (next) => {
        if (run !== runId.current) return;
        setSnap(next);
        if (next.phase === "ready") clearConnect();
        if (next.phase === "ended") {
          clearConnect();
          const why = explain(next);
          if (why) setProblem(why);
          else setFinished(true);
        }
      },
    });
    client.current = c;
    starting.current = false;
    setSnap(c.snapshot);
    connectTimer.current = setTimeout(() => {
      if (run !== runId.current || c.snapshot.phase !== "connecting") return;
      timedOut.current = true;
      c.stop();
    }, REAL_CONNECT_MS);
    await c.start();
  }, [reset]);

  const retry = React.useCallback(() => {
    runId.current++; // the stop of the old one is not news
    starting.current = false;
    const c = client.current;
    client.current = null;
    c?.stop();
    audio.current?.close();
    audio.current = null;
    void start();
  }, [start]);

  const startNow = React.useCallback(() => void start(), [start]);
  const toggleMute = React.useCallback(() => {
    mutedRef.current = !mutedRef.current;
    audio.current?.mute?.(mutedRef.current);
    setMuted(mutedRef.current);
  }, []);
  const bargeIn = React.useCallback(() => client.current?.bargeIn(), []);

  // the plan's Yes / No by tap (a spoken "yes" arrives as the socket's own `action` message)
  const decide = React.useCallback(
    async (answer: "yes" | "change") => {
      const plan = snap?.plan;
      if (!plan || planBusy) return;
      setPlanBusy(true);
      setPlanError(null);
      const { o } = opts.current;
      const out = await (o.confirm ?? confirmPlan)(o.base ?? baseOfPage() ?? "", plan.actionId, answer === "yes" ? "yes" : "no");
      setPlanBusy(false);
      if (out.ok) setDecided({ id: plan.actionId, status: out.status });
      else if (out.error === "expired") setDecided({ id: plan.actionId, status: "expired" });
      else setPlanError(out.error === "mfa" ? "bv.chat.err.mfa" : out.error === "forbidden" ? "bv.chat.err.forbidden" : out.error === "state" ? "bv.chat.state.done" : "bv.chat.err.down");
    },
    [snap?.plan, planBusy],
  );

  const live = active && snap !== null && snap.phase === "ready";
  const listening = live && snap.state === "listening";
  const heardLast = `${snap?.captions.length ?? 0}:${snap?.captions.at(-1)?.text.length ?? 0}`;
  const quietSince = React.useRef(0);
  React.useEffect(() => {
    if (listening) quietSince.current = Date.now();
  }, [listening, heardLast]);
  // 30 s of nobody speaking ends it (not while muted: a muted person is not "quiet")
  React.useEffect(() => {
    if (!listening || muted) return;
    const id = setTimeout(() => client.current?.stop(), REAL_SILENCE_MS);
    return () => clearTimeout(id);
  }, [listening, muted, heardLast]);
  // a clock once a second: the seconds shown, the quiet spell, the time left
  const readyAt = snap?.readyAt ?? null;
  const sessionSeconds = snap?.sessionSeconds ?? null;
  const endingIn = snap?.endingIn ?? null;
  const endingAt = snap?.endingAt ?? null;
  React.useEffect(() => {
    if (!live || readyAt === null) return;
    const tick = () => {
      const t = Date.now();
      setSeconds(Math.max(0, Math.floor((t - readyAt) / 1000)));
      const told = endingIn !== null && endingAt !== null ? Math.round(endingIn - (t - endingAt) / 1000) : null;
      setClock({ quietMs: listening && !muted ? t - quietSince.current : 0, left: told ?? (sessionSeconds !== null ? Math.round(sessionSeconds - (t - readyAt) / 1000) : null) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live, listening, muted, readyAt, sessionSeconds, endingIn, endingAt]);
  // never listen in the background: the microphone is off the moment the tab is hidden
  React.useEffect(() => {
    if (!active) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") client.current?.stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [active]);

  const lines = React.useMemo<TalkLine[]>(() => (snap?.captions ?? []).filter((c) => c.text.trim() !== "").map((c) => ({ who: c.who === "user" ? "owner" : "assistant", text: c.text, ...(c.cut ? { cut: true } : {}) })), [snap?.captions]);
  // C1 (13 Nov): until the API says `state: speaking` before an answer's first sound, an answer goes thinking, audio, listening: the sound itself makes it "speaking"
  const [sounding, setSounding] = React.useState(false);
  React.useEffect(() => {
    if (!live || !io) return;
    const id = setInterval(() => setSounding(io.playing()), 120);
    return () => {
      clearInterval(id);
      setSounding(false);
    };
  }, [live, io]);
  const serverState: TalkState = STATE[snap?.state ?? ""] ?? "listening";
  const state: TalkState = sounding && (serverState === "thinking" || serverState === "speaking") ? "speaking" : serverState;
  const plan = snap?.plan ?? null;
  const planStatus: ActionStatus | null = plan ? (decided && decided.id === plan.actionId ? decided.status : plan.status) : null;
  const left = clock.left !== null && clock.left > 0 && clock.left <= REAL_WARN_S ? clock.left : null;
  const notice: TalkLive["notice"] = left !== null ? { kind: "ending", seconds: left } : listening && !muted && clock.quietMs >= REAL_CHECKIN_MS ? { kind: "checkin", seconds: Math.max(0, Math.ceil((REAL_SILENCE_MS - clock.quietMs) / 1000)) } : null;
  const analyser = live && io ? (state === "speaking" ? io.analyser("voice") : state === "listening" && !muted ? io.analyser("mic") : null) : null;

  return {
    real: true,
    active,
    state,
    seconds,
    lines,
    plan: plan ? planOf(plan) : null,
    answer: planStatus === "confirmed" || planStatus === "running" || planStatus === "done" ? "yes" : planStatus === "declined" ? "change" : null,
    muted,
    start: startNow,
    end,
    toggleMute,
    decide: (a) => void decide(a),
    connecting: active && !problem && snap !== null && snap.phase === "connecting",
    problem,
    retry,
    finished,
    analyser,
    notice,
    turnProblem: live ? snap.problem : null,
    planStatus,
    planBusy,
    planError,
    bargeIn,
  };
}
