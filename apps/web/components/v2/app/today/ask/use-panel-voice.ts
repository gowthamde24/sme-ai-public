"use client";

import * as React from "react";

import { browserAudio } from "@/lib/browser-voice/audio-io";
import { VoiceClient, type AudioIO, type Snapshot, type SocketLike } from "@/lib/browser-voice/client";
import type { EndWord } from "@/lib/browser-voice/protocol";
import { askVoiceToken } from "@/lib/browser-voice/token";

import type { BrowserVoice } from "./browser-voice";
import type { AskSession } from "./use-ask-session";

export type PanelVoiceOptions = { audioFactory?: () => AudioIO; socketFactory?: (url: string) => SocketLike };
export type PanelVoice = {
  /** A spoken conversation is open (connecting, listening, thinking or speaking). */
  active: boolean;
  state: Snapshot["state"];
  step: Snapshot["step"];
  /** What the person is saying right now, word by word, until it is final; "" when nobody is. */
  interim: string;
  /** The turn in progress: the words heard and the reply so far (the reply streams in as it is spoken). null when no turn has begun. */
  live: { asked: string; answer: string; cut: boolean } | null;
  end: EndWord | null;
  micDenied: boolean;
  /** The voice speaking now (name, language), as the API said; null until it says. */
  voice: Snapshot["voice"];
  /** The conversation is being opened (the microphone is on, the API has not said ready). */
  connecting: boolean;
  /** Nobody has spoken for LIVE_CHECKIN_MS: the seconds left until it ends by itself (it waits, "Paused"); null while the conversation is lively. */
  checkIn: number | null;
  /** The last LIVE_WARN_S seconds of the conversation's time limit: the seconds left; null before that (and when the API gave no limit). */
  sessionLeft: number | null;
  /** A refusal that does not end the conversation (the hourly limit): its code, until the next turn. */
  problem: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** A tap while it talks. */
  bargeIn: () => void;
  analyser: (which: "mic" | "voice") => AnalyserNode | null;
};

const TOKEN_FRESH_MS = 20 * 60_000;
/** Live talk ends by itself when nobody speaks for this long while it listens (owner, 30 Oct: about 30 seconds). */
export const LIVE_SILENCE_MS = 30_000;
/** After this much quiet while it listens, ONE gentle check-in is shown ("Still there?") and the state reads "Paused" (job live-conversation-standard D3). */
export const LIVE_CHECKIN_MS = 8_000;
/** The screen warns when this many seconds are left of the conversation's time limit (13 minutes of 15). */
export const LIVE_WARN_S = 120;

/**
 * The spoken conversation INSIDE the chat panel (never full screen): the API's socket (lib/browser-voice) with the person's words shown LIVE as they speak (the interim caption, replaced by the final one) and the reply streaming below as text while it is spoken.
 * A finished turn joins the SAME thread as the typed messages (`session.addExchange`). The floating circle follows what the conversation is doing (`session.setVoiceOrb`). The sign-in is asked for before the tap, so the tap itself can open the microphone.
 */
export function usePanelVoice(session: AskSession, voice: BrowserVoice, options: PanelVoiceOptions = {}): PanelVoice {
  const { audioFactory = browserAudio, socketFactory = (u: string) => new WebSocket(u) as unknown as SocketLike } = options;
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [live, setLive] = React.useState<{ asked: string; answer: string; interim: string; cut: boolean } | null>(null);
  const client = React.useRef<VoiceClient | null>(null);
  const audio = React.useRef<AudioIO | null>(null);
  const token = React.useRef<{ value: string; at: number } | null>(null);
  const flushedId = React.useRef(0); // the id of the last caption that has joined the thread
  const started = React.useRef(false); // a second start is a silent restart: no greeting is played or shown again
  const sourcesSeen = React.useRef(0);
  const decidedSeen = React.useRef(0);
  const { addExchange, setVoiceOrb, setEarlier, setPlan } = session;
  const { tokenUrl, url, language } = voice;

  React.useEffect(() => {
    let alive = true;
    void askVoiceToken(tokenUrl).then((out) => {
      if (alive && out.ok) token.current = { value: out.token, at: Date.now() };
    });
    return () => {
      alive = false;
    };
  }, [tokenUrl]);
  React.useEffect(
    () => () => {
      client.current?.stop();
      setVoiceOrb(null);
    },
    [setVoiceOrb],
  );

  /**
   * Every change of the conversation (the socket's events, not a render). The captions are read from the one that has not joined the thread yet (by its id): the person's words are ONE caption per utterance (replaced in place, interim then final) and the assistant's words ONE caption
   * per kind (its pieces are joined by the client), so a caption can still grow after it was first seen. A turn joins the thread when the next one begins or when the assistant listens again; the floating circle and the live line follow.
   */
  const onChange = (next: Snapshot) => {
    const turns: { asked: string; answer: string; upto: number; cut: boolean }[] = [];
    let asked = "";
    let answer = "";
    let cut = false; // an answer of this turn was cut off by the person
    let partialUser: string | null = null;
    let partialAsst = "";
    let lastId = flushedId.current;
    for (const c of next.captions) {
      if (c.id <= flushedId.current) continue;
      if (c.who === "user") {
        if (answer !== "") {
          turns.push({ asked, answer, upto: lastId, cut }); // an answer is complete when the person speaks again
          asked = "";
          answer = "";
          cut = false;
        }
        if (c.final) {
          asked = c.text;
          partialUser = null;
        } else partialUser = c.text;
      } else {
        if (c.cut) cut = true;
        if (c.final) answer = answer !== "" ? `${answer}\n\n${c.text}` : c.text;
        else partialAsst = c.text;
      }
      lastId = c.id;
    }
    if (partialUser === null && (asked !== "" || answer !== "") && (next.phase === "ended" || (next.state === "listening" && answer !== ""))) { // (a question alone waits for its answer: the state may still say "listening" for a moment after the words are final)
      turns.push({ asked, answer, upto: lastId, cut });
      asked = "";
      answer = "";
      cut = false;
    }
    for (const t of turns) {
      const mine = next.sources.slice(sourcesSeen.current).map((x) => ({ label: x.label, href: null }));
      sourcesSeen.current = next.sources.length;
      addExchange({ asked: t.asked, heardByVoice: true, answer: t.answer, interrupted: t.cut, sources: mine, drafts: [], errorCode: null, failed: false, task: null, plan: next.plan });
      flushedId.current = t.upto;
    }
    // an answer to a plan (the owner's tap, or a spoken "yes" the API recognised): the card in the thread shows its state
    for (const d of next.decided.slice(decidedSeen.current)) {
      setEarlier((list) => list.map((x) => (x.plan && x.plan.actionId === d.actionId ? { ...x, plan: { ...x.plan, status: d.status } } : x)));
      setPlan((p) => (p && p.actionId === d.actionId ? { ...p, status: d.status } : p));
    }
    decidedSeen.current = next.decided.length;
    setVoiceOrb(next.phase === "ended" ? null : next.state === "listening" ? "listen" : next.state === "speaking" ? "speak" : next.state === "thinking" || next.phase === "connecting" ? "think" : null);
    const shownAsked = partialUser ?? asked;
    const shownAnswer = partialAsst !== "" ? (answer !== "" ? `${answer}\n\n${partialAsst}` : partialAsst) : answer;
    setLive(next.phase !== "ended" && (shownAsked !== "" || shownAnswer !== "") ? { asked: shownAsked, answer: shownAnswer, interim: partialUser ?? "", cut } : null);
    if (next.conversationId) session.adoptConversation(next.conversationId); // typed turns after a spoken one are the same conversation
    setSnap(next);
  };

  const start = async () => {
    if (client.current && snap && snap.phase !== "ended") return;
    if (token.current === null || Date.now() - token.current.at > TOKEN_FRESH_MS) {
      const out = await askVoiceToken(tokenUrl);
      if (!out.ok) return setSnap({ phase: "ended", state: null, step: null, captions: [], sources: [], language, end: "signin", micDenied: false, plan: null, decided: [], voice: null, conversationId: null, problem: null, sessionSeconds: null, readyAt: null });
      token.current = { value: out.token, at: Date.now() };
    }
    flushedId.current = 0;
    sourcesSeen.current = 0;
    decidedSeen.current = 0;
    audio.current = audioFactory();
    const c = new VoiceClient({ url, token: token.current.value, language, audio: audio.current, socket: socketFactory, onChange, quietStart: started.current, conversationId: session.conversationId() });
    started.current = true;
    client.current = c;
    setSnap(c.snapshot);
    await c.start();
  };

  const stop = () => client.current?.stop();
  const bargeIn = () => client.current?.bargeIn();
  const analyser = (which: "mic" | "voice") => audio.current?.analyser(which) ?? null;

  const active = snap !== null && snap.phase !== "ended";
  // hands-free: after every answer it listens again; 30 s of nobody speaking ends the conversation (the words, if any, are already in the thread)
  const listening = active && snap?.state === "listening";
  const heardLast = `${snap?.captions.length ?? 0}:${snap?.captions.at(-1)?.text.length ?? 0}`; // any new word restarts the 30 s
  React.useEffect(() => {
    if (!listening) return;
    const id = setTimeout(() => client.current?.stop(), LIVE_SILENCE_MS);
    return () => clearTimeout(id);
  }, [listening, heardLast]);
  // a clock for the screen while a conversation is open: the check-in after a quiet spell and the warning before the time limit (read once a second, from the clock, never during a render)
  const quietSince = React.useRef(0); // when the quiet began: a new word, or the assistant finishing, restarts it
  React.useEffect(() => {
    if (listening) quietSince.current = Date.now();
  }, [listening, heardLast]);
  const [clock, setClock] = React.useState<{ quietMs: number; left: number | null }>({ quietMs: 0, left: null });
  const sessionSeconds = snap?.sessionSeconds ?? null;
  const readyAt = snap?.readyAt ?? null;
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const t = Date.now();
      setClock({ quietMs: listening ? t - quietSince.current : 0, left: sessionSeconds !== null && readyAt !== null ? Math.round(sessionSeconds - (t - readyAt) / 1000) : null });
    }, 1000);
    return () => clearInterval(id);
  }, [active, listening, sessionSeconds, readyAt]);
  const checkIn = listening && clock.quietMs >= LIVE_CHECKIN_MS ? Math.max(0, Math.ceil((LIVE_SILENCE_MS - clock.quietMs) / 1000)) : null;
  const sessionLeft = active && clock.left !== null && clock.left > 0 && clock.left <= LIVE_WARN_S ? clock.left : null;
  // never listen in the background (D4, D6): the microphone is off the moment the tab is hidden
  React.useEffect(() => {
    if (!active) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") client.current?.stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [active]);
  return { active, state: snap?.state ?? null, step: snap?.step ?? null, interim: live?.interim ?? "", live: live ? { asked: live.asked, answer: live.answer, cut: live.cut } : null, end: snap?.end ?? null, problem: snap?.problem ?? null, micDenied: snap?.micDenied ?? false, voice: snap?.voice ?? null, connecting: snap?.phase === "connecting", checkIn, sessionLeft, start, stop, bargeIn, analyser };
}
