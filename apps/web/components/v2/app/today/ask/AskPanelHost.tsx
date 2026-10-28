"use client";

import { VoiceChat } from "../../voice-chat/VoiceChat";
import { AskPanel } from "./AskPanel";
import type { BrowserVoice } from "./browser-voice";
import type { AskSession } from "./use-ask-session";

/**
 * What the floating orb opens, in ONE lazy chunk (the route-JS budget counts every byte the orb's own file adds to a page): the written panel, or, where "Talk to your assistant" is on and the person pressed the orb, the voice chat ("Type instead" there
 * opens the panel).
 */
export function AskPanelHost({ session, chips, onClose, voice, onType }: { session: AskSession | null; chips: readonly string[]; onClose: () => void; voice: BrowserVoice | null; onType: () => void }) {
  if (voice) return <VoiceChat words={voice.words} url={voice.url} language={voice.language} languageNames={voice.languageNames} getToken={voice.getToken} onClose={onClose} onType={onType} />;
  return session ? <AskPanel session={session} chips={chips} onClose={onClose} /> : null;
}
