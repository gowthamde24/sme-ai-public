"use client";

import * as React from "react";

import { browserAudio } from "@/lib/browser-voice/audio-io";
import { VoiceClient, type AudioIO, type Snapshot, type SocketLike } from "@/lib/browser-voice/client";
import { askVoiceToken } from "@/lib/browser-voice/token";

import type { BrowserVoice } from "../today/ask/browser-voice";
import type { HearLang } from "./voice-lang";

export type MicState = "idle" | "asking" | "listening" | "finishing";
export type MicError = "denied" | "no_speech" | "daily" | "failed";
/** `keep_going`: it stopped at the 30 second limit, the words are in the field, and one more tap carries on. */
export type MicNotice = "keep_going";

/** Auto-stop after this long without new words (once something was heard), a longer wait for the first words, and a hard ceiling (owner decision, 9 Nov 2026). */
export const SILENCE_MS = 2000;
export const FIRST_WORDS_MS = 10_000;
export const MAX_SECONDS = 30; // the speech service takes 30 s at a time: at 30 s the dictation stops, the words are in the field, and "Tap the mic to keep going" is said

const joined = (s: Snapshot): string =>
  s.captions
    .filter((c) => c.who === "user")
    .map((c) => c.text.trim())
    .filter((t) => t !== "")
    .join(" ");

/** The browser can record and has a socket (otherwise the microphone button is not drawn at all). Never true on the server: the first draw is the same everywhere. */
export const canDictate = (): boolean => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof WebSocket !== "undefined";
const subscribeNothing = () => () => undefined;

export type VoiceInputOptions = { audioFactory?: () => AudioIO; socketFactory?: (url: string) => SocketLike; /** a browser that can record, said by the caller (tests; a real browser is asked) */ supported?: boolean; /** the longest one dictation lasts (tests make it short); default 30 s */ maxSeconds?: number };
/** What every microphone below uses in place of the browser's own audio and socket (tests hand in fakes; nothing in the product sets it). */
export const VoiceInputOptionsContext = React.createContext<VoiceInputOptions>({});

/**
 * Voice typing for any text field (owner decision, 9 Nov 2026): the same speech path as the assistant's box (lib/browser-voice, the voice socket in `dictate` mode: the words only, no answer, nothing stored, the microphone's audio goes
 * to the API as it is spoken and is kept nowhere, so there is no recording to delete). `onWords` gets everything said so far in this dictation, whole, each time it changes (final words replace the partial ones). It stops by itself
 * 2 seconds after the last words (10 seconds if nothing was said at all) and at 60 seconds, when the tab is hidden, and on a tap. It never submits or saves: what it does with the words is the caller's.
 */
export function useVoiceInput(voice: BrowserVoice | null, hear: HearLang, onWords: (text: string) => void, options: VoiceInputOptions = {}) {
  const given = React.useContext(VoiceInputOptionsContext);
  const { audioFactory = given.audioFactory ?? browserAudio, socketFactory = given.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as SocketLike) } = options;
  const maxSeconds = options.maxSeconds ?? given.maxSeconds ?? MAX_SECONDS;
  const browser = React.useSyncExternalStore(subscribeNothing, canDictate, () => false);
  const supported = (options.supported ?? given.supported ?? browser) && voice !== null;
  const [state, setState] = React.useState<MicState>("idle");
  const [error, setError] = React.useState<MicError | null>(null);
  const [seconds, setSeconds] = React.useState(0);
  const [notice, setNotice] = React.useState<MicNotice | null>(null);
  const client = React.useRef<VoiceClient | null>(null);
  const words = React.useRef(onWords);
  React.useEffect(() => {
    words.current = onWords;
  });

  React.useEffect(
    () => () => {
      client.current?.stop();
    },
    [],
  );
  // never listen in the background: the microphone is off the moment the tab is hidden
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") client.current?.stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const start = React.useCallback(async () => {
    if (!voice || client.current) return;
    setError(null);
    setNotice(null);
    setSeconds(0);
    setState("asking");
    const out = await askVoiceToken(voice.tokenUrl);
    if (!out.ok) {
      setState("idle");
      return setError("failed");
    }
    let heard = false;
    let lastWords = "";
    let lastChange = Date.now();
    let began = 0;
    let maxed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const c: VoiceClient = new VoiceClient({
      url: voice.url,
      token: out.token,
      language: voice.language,
      audio: audioFactory(),
      socket: socketFactory,
      mode: "dictate",
      sttLanguage: hear === "auto" ? null : hear, // a language pinned: the words come in its script from the first one (Telugu with English words in it is still Telugu); "auto" listens for any
      onChange: (snap) => {
        if (client.current !== c) return;
        const text = joined(snap);
        if (text !== "" && text !== lastWords) {
          lastWords = text;
          lastChange = Date.now();
          heard = true;
          words.current(text);
        }
        if (snap.phase === "ready" && began === 0) {
          began = Date.now();
          lastChange = began;
          setState("listening");
          timer = setInterval(() => {
            const now = Date.now();
            setSeconds(Math.floor((now - began) / 1000));
            const quietFor = now - lastChange;
            if (now - began >= maxSeconds * 1000) maxed = true;
            if (maxed || (heard && quietFor >= SILENCE_MS) || (!heard && quietFor >= FIRST_WORDS_MS)) {
              setState("finishing");
              c.stop();
            }
          }, 250);
        }
        if (snap.phase === "ended") {
          if (timer) clearInterval(timer);
          client.current = null;
          setState("idle");
          if (maxed && heard) setNotice("keep_going");
          if (snap.micDenied) setError("denied");
          else if (snap.end === "daily") setError("daily");
          else if (!heard) setError(snap.end === "signin" || snap.end === "unavailable" || snap.end === "rate" || snap.end === "busy" ? "failed" : "no_speech");
        }
      },
    });
    client.current = c;
    await c.start();
  }, [voice, hear, audioFactory, socketFactory, maxSeconds]);

  const stop = React.useCallback(() => {
    if (client.current) {
      setState("finishing");
      client.current.stop();
    }
  }, []);
  const toggle = React.useCallback(() => {
    if (client.current) return stop();
    if (state === "idle") void start();
  }, [state, start, stop]);
  return { supported, state, seconds, error, notice, clearError: () => setError(null), toggle, stop };
}
