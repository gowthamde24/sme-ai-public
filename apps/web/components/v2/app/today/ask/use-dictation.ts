"use client";

import * as React from "react";

import { browserAudio } from "@/lib/browser-voice/audio-io";
import { VoiceClient, type AudioIO, type Snapshot, type SocketLike } from "@/lib/browser-voice/client";
import { askVoiceToken } from "@/lib/browser-voice/token";

import type { BrowserVoice } from "./browser-voice";
import { MAX_QUESTION } from "./ask-constants";
import type { PanelVoiceOptions } from "./use-panel-voice";
import type { AskSession } from "./use-ask-session";

export type Dictation = {
  /** `connecting` = the microphone and the socket are opening; `listening` = the words are coming into the box. */
  state: "idle" | "connecting" | "listening";
  /** Why nothing was written, as a word key of the chat's own words (the microphone was refused, nobody spoke, voice is off), or null. */
  error: string | null;
  /** Tap: start; tap again: stop (the words stay in the box). */
  toggle: () => void;
  stop: () => void;
};

const joined = (s: Snapshot): string =>
  s.captions
    .filter((c) => c.who === "user")
    .map((c) => c.text.trim())
    .filter((t) => t !== "")
    .join(" ");

/**
 * Dictation (owner, 30 Oct): the microphone writes into the TEXT BOX as the person speaks, and nothing is asked until they press Send. It uses the voice socket's words-only mode (`mode: "dictate"`: the same recogniser, but no answer, no voice
 * and nothing stored), so the words come word by word, final words replacing the partial ones. What was in the box stays in front of the new words. The API ends it by itself a few seconds after the last words; a tap ends it at once.
 */
export function useDictation(session: AskSession, voice: BrowserVoice, options: PanelVoiceOptions = {}): Dictation {
  const { audioFactory = browserAudio, socketFactory = (u: string) => new WebSocket(u) as unknown as SocketLike } = options;
  const [state, setState] = React.useState<Dictation["state"]>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const client = React.useRef<VoiceClient | null>(null);
  const { setText } = session;
  const { tokenUrl, url, language } = voice;

  React.useEffect(
    () => () => {
      client.current?.stop();
    },
    [],
  );

  const start = async () => {
    setError(null);
    setState("connecting");
    const out = await askVoiceToken(tokenUrl);
    if (!out.ok) {
      setState("idle");
      return setError("voice_unavailable");
    }
    const audio: AudioIO = audioFactory();
    let heardAny = false;
    const before = session.text.trim() === "" ? "" : `${session.text.trimEnd()} `; // what was already in the box stays in front of the new words
    const c = new VoiceClient({
      url,
      token: out.token,
      language,
      audio,
      socket: socketFactory,
      mode: "dictate",
      onChange: (snap) => {
        if (client.current !== c) return;
        const words = joined(snap);
        if (words !== "") {
          heardAny = true;
          setText(`${before}${words}`.slice(0, MAX_QUESTION));
        }
        if (snap.phase === "ready") setState("listening");
        if (snap.phase === "ended") {
          client.current = null;
          setState("idle");
          if (snap.micDenied) setError("denied");
          else if (!heardAny) setError(snap.end === "signin" || snap.end === "unavailable" ? "voice_unavailable" : "voice_no_speech");
        }
      },
    });
    client.current = c;
    await c.start();
  };
  const stop = () => client.current?.stop();
  const toggle = () => {
    if (client.current) return stop();
    if (state === "idle") void start();
  };
  return { state, error, toggle, stop };
}
