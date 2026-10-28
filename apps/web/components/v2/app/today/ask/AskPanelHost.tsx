"use client";

import { AskPanel } from "./AskPanel";
import type { BrowserVoice } from "./browser-voice";
import { ChatPanel } from "./ChatPanel";
import type { AskSession } from "./use-ask-session";

/**
 * What the floating circle opens, in ONE lazy chunk (the route-JS budget counts every byte the circle's own file adds to a page). Where the spoken conversation is on (BROWSER_VOICE) it is the conversation panel: one line to write in, the microphone working in place,
 * one thread for typed and spoken turns (never a full-screen screen). Otherwise it is the written panel.
 */
export default function AskPanelHost({ session, chips, onClose, voice }: { session: AskSession | null; chips: readonly string[]; onClose: () => void; voice?: BrowserVoice | null }) {
  if (!session) return null;
  return voice ? <ChatPanel session={session} chips={chips} voice={voice} onClose={onClose} /> : <AskPanel session={session} chips={chips} onClose={onClose} />;
}
