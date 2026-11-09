"use client";

import * as React from "react";

import type { BrowserVoice } from "../today/ask/browser-voice";
import { browserRecorder, type Recorder } from "./recorder";
import type { HearLang } from "./voice-lang";

export type MicState = "idle" | "asking" | "listening" | "finishing";
export type MicError = "denied" | "no_speech" | "daily" | "failed";
/** `keep_going`: it stopped at the time limit, the words are in the field, and one more tap carries on. */
export type MicNotice = "keep_going";

/** Auto-stop after this long without speech (once something was said), a longer wait for the first words, and the time limit of one recording: the speech service takes 30 s, so it stops at 28 (owner decision, 9 Nov 2026). */
export const SILENCE_MS = 2000;
export const FIRST_WORDS_MS = 10_000;
export const MAX_SECONDS = 28;
/** A level above this (of 1) is speech. */
export const SPEECH_LEVEL = 0.02;

/** The browser can record (otherwise the microphone button is not drawn at all). Never true on the server: the first draw is the same everywhere. */
export const canDictate = (): boolean => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
const subscribeNothing = () => () => undefined;

export type VoiceInputOptions = { recorderFactory?: () => Recorder; /** a browser that can record, said by the caller (tests; a real browser is asked) */ supported?: boolean; /** the longest one recording lasts (tests make it short); default 28 s */ maxSeconds?: number };
/** What every microphone below uses in place of the browser's own recorder (tests hand in fakes; nothing in the product sets it). */
export const VoiceInputOptionsContext = React.createContext<VoiceInputOptions>({});

type Refusal = { error?: { code?: string } };

/**
 * Voice typing for any text field (owner decision, 9 Nov 2026): the browser records (never stored: see recorder.ts), the recording goes to this app's own route `<workspace>/speech-transcribe`, which passes it to the API's
 * `POST /speech/transcribe` (the brand and Indian amounts come back written properly), and the words come back to `onWords` whole, once. The language is the one on the chip (the app's language by default; "auto" only from the chip).
 * It stops by itself 2 seconds after the person stops speaking (10 seconds if nothing was said), at 28 seconds (the service's limit is 30), when the tab is hidden (then nothing is sent), and on a tap. It never submits or saves.
 */
export function useVoiceInput(voice: BrowserVoice | null, hear: HearLang, onWords: (text: string) => void, options: VoiceInputOptions = {}) {
  const given = React.useContext(VoiceInputOptionsContext);
  const recorderFactory = options.recorderFactory ?? given.recorderFactory ?? browserRecorder;
  const maxSeconds = options.maxSeconds ?? given.maxSeconds ?? MAX_SECONDS;
  const browser = React.useSyncExternalStore(subscribeNothing, canDictate, () => false);
  const supported = (options.supported ?? given.supported ?? browser) && voice !== null && !!voice.speechUrl;
  const [state, setState] = React.useState<MicState>("idle");
  const [error, setError] = React.useState<MicError | null>(null);
  const [notice, setNotice] = React.useState<MicNotice | null>(null);
  const [seconds, setSeconds] = React.useState(0);
  const recorder = React.useRef<Recorder | null>(null);
  const finishNow = React.useRef<(() => void) | null>(null);
  const words = React.useRef(onWords);
  React.useEffect(() => {
    words.current = onWords;
  });

  React.useEffect(
    () => () => {
      recorder.current?.cancel();
      recorder.current = null;
    },
    [],
  );
  // never record in the background: the microphone is off the moment the tab is hidden, and nothing is sent
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && recorder.current) {
        recorder.current.cancel();
        recorder.current = null;
        finishNow.current = null;
        setState("idle");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const start = React.useCallback(async () => {
    if (!voice?.speechUrl || recorder.current) return;
    setError(null);
    setNotice(null);
    setSeconds(0);
    setState("asking");
    const r = recorderFactory();
    recorder.current = r;
    try {
      await r.start();
    } catch {
      recorder.current = null;
      setState("idle");
      return setError("denied");
    }
    if (recorder.current !== r) return; // (cancelled while the browser was asking)
    const began = Date.now();
    let spoke = false;
    let lastLoud = began;
    let maxed = false;
    let finishing = false;
    setState("listening");
    const finish = async (manual: boolean) => {
      if (finishing) return;
      finishing = true;
      clearInterval(timer);
      finishNow.current = null;
      setState("finishing");
      const blob = await r.stop();
      if (recorder.current !== r) return;
      recorder.current = null;
      const length = Date.now() - began;
      // nothing was said: nothing is sent (a tap after a second or more is sent anyway: a quiet voice may not reach the meter)
      if (!blob || (!spoke && !(manual && length >= 1000))) {
        setState("idle");
        return setError("no_speech");
      }
      try {
        const form = new FormData();
        form.set("audio", blob, "speech");
        form.set("language", hear);
        const res = await fetch(voice.speechUrl as string, { method: "POST", body: form, credentials: "same-origin", cache: "no-store" });
        const json = (await res.json().catch(() => null)) as ({ text?: unknown } & Refusal) | null;
        if (!res.ok) {
          const code = json?.error?.code;
          setError(res.status === 429 || code === "cap_reached" ? "daily" : code === "empty" ? "no_speech" : "failed");
        } else {
          const text = typeof json?.text === "string" ? json.text.trim() : "";
          if (text === "") setError("no_speech");
          else {
            words.current(text);
            if (maxed) setNotice("keep_going");
          }
        }
      } catch {
        setError("failed");
      }
      setState("idle");
    };
    finishNow.current = () => void finish(true);
    const timer = setInterval(() => {
      const now = Date.now();
      setSeconds(Math.floor((now - began) / 1000));
      if (r.level() > SPEECH_LEVEL) {
        spoke = true;
        lastLoud = now;
      }
      if (now - began >= maxSeconds * 1000) {
        maxed = true;
        void finish(false);
      } else if (spoke && now - lastLoud >= SILENCE_MS) void finish(false);
      else if (!spoke && now - began >= FIRST_WORDS_MS) void finish(false);
    }, 100);
  }, [voice, hear, recorderFactory, maxSeconds]);

  const toggle = React.useCallback(() => {
    if (recorder.current) return finishNow.current?.();
    if (state === "idle") void start();
  }, [state, start]);
  return { supported, state, seconds, error, notice, clearError: () => setError(null), toggle };
}
