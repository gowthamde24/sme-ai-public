"use client";

import * as React from "react";

import type { VoiceLang } from "@/lib/browser-voice/protocol";

import { TalkLiveBody } from "../../ds/talk/TalkLive";
import type { TalkKind } from "../../ds/talk/script";
import { useTalkLive } from "../../ds/talk/use-talk-live";
import type { Words } from "../../words";
import { setTalkAnalyser, setTalkBarge, setTalkMood } from "./v6-state";

/**
 * The live conversation inside the command bar (design system v6): starts the moment it is drawn (the person tapped the orb) and is drawn only then, so it is a lazy chunk (`LazyLiveBar`) that Today's first paint does not carry. End returns the bar to normal; "Type" returns to the input.
 * With BROWSER_VOICE on (staging) the voice is REAL (the browser voice socket, `useRealTalk`); without it the made-up conversation plays and says so. The orb outside the composer follows the state AND the loudness (`setTalkMood`, `setTalkAnalyser`), and a tap on it while the assistant speaks cuts it off (`setTalkBarge`).
 */
export default function LiveBar({ kind = "command", appLang = "en", variant = "card", words, language, voiceLanguage, stt = null, onClose }: { /** The app language: the plan card's time phrase is written in it. The words (buttons, status and error lines) arrive in it too: only what is SAID follows the conversation's language (owner, 14 Nov). */ appLang?: string; /** `bar`: inside the desktop command bar (the approved mock). */ variant?: "card" | "bar"; kind?: TalkKind; words: Words; /** The language's own name, as the bar shows it. */ language: string; /** What the assistant answers and speaks in (the composer's language), and what the recogniser is pinned to; default: the app's language, detecting. */ voiceLanguage?: VoiceLang; stt?: VoiceLang | null; /** The bar goes back to normal (End or Type, or the conversation ended in a normal way). */ onClose: (via: "end" | "type") => void }) {
  const live = useTalkLive(kind, { ...(voiceLanguage ? { language: voiceLanguage } : {}), stt });
  const { start, end, finished, bargeIn } = live;
  React.useEffect(() => {
    start();
    return end;
  }, [start, end]);
  // the orb outside the composer follows the conversation
  const state = live.connecting ? "thinking" : live.state;
  React.useEffect(() => {
    setTalkMood(state);
    return () => setTalkMood(null);
  }, [state]);
  const analyser = live.analyser ?? null;
  React.useEffect(() => {
    setTalkAnalyser(analyser);
    return () => setTalkAnalyser(null);
  }, [analyser]);
  React.useEffect(() => {
    setTalkBarge(bargeIn ?? null);
    return () => setTalkBarge(null);
  }, [bargeIn]);
  // a normal end (the person said bye): the bar goes back to normal on its own
  React.useEffect(() => {
    if (finished) onClose("end");
  }, [finished, onClose]);
  return (
    <TalkLiveBody
      live={{ ...live, end: () => { end(); onClose("end"); } }}
      words={words}
      appLang={appLang}
      language={language}
      variant={variant}
      onType={() => {
        end();
        onClose("type");
      }}
    />
  );
}
