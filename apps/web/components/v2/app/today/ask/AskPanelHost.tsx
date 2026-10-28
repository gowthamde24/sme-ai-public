"use client";

import * as React from "react";

import { VoiceChat } from "../../voice-chat/VoiceChat";
import { AskPanel } from "./AskPanel";
import type { BrowserVoice } from "./browser-voice";
import type { AskSession } from "./use-ask-session";

/**
 * What the floating orb opens, in ONE lazy chunk (the route-JS budget counts every byte the orb's own file adds to a page): the written panel, or, where "Talk to your assistant" is on, the voice chat first ("Type instead" there shows the panel).
 */
export function AskPanelHost({ session, chips, onClose, voice }: { session: AskSession | null; chips: readonly string[]; onClose: () => void; voice: BrowserVoice | null }) {
  const [typed, setTyped] = React.useState(false);
  if (voice && !typed) return <VoiceChat words={voice.words} url={voice.url} language={voice.language} languageNames={voice.languageNames} getToken={voice.getToken} onClose={onClose} onType={() => setTyped(true)} />;
  return session ? <AskPanel session={session} chips={chips} onClose={onClose} /> : null;
}
