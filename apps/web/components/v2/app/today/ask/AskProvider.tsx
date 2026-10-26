"use client";

import * as React from "react";

import type { AskTransport, Availability, VoiceStatus, VoiceTransport } from "./ask-types";
import type { AskWords } from "./ask-words";
import { AskFloating } from "./AskFloating";
import { useAskSession, type AskSession } from "./use-ask-session";

const AskContext = React.createContext<AskSession | null>(null);

/** The conversation of this workspace, if a provider made one: Today's card and the floating panel read the SAME one. Null outside a provider (a page rendered on its own, a test): the card then makes a session of its own. */
export function useSharedAsk(): AskSession | null {
  return React.useContext(AskContext);
}

/**
 * One conversation for the whole workspace (job DQ part 0): the tenant layout wraps the pages in this, so the thread, the streaming answer and the microphone survive moving from screen to screen (the layout stays mounted while the
 * pages change). Today draws it in the assistant's card; every other screen draws the floating orb and its panel (AskFloating). `availability` is what the server knows: only "live" makes anything to ask with; `readOnly` hides the orb
 * (a read-only workspace asks nothing of the AI).
 */
export function AskProvider({ lang, base, words, availability, readOnly = false, chipWords, transport, voiceStatus, voiceTransport, children }: { lang: string; base: string; words: AskWords; availability: Availability; readOnly?: boolean; /** The words of the suggestion chips for the screens (the server resolves them for the language and the business type). */ chipWords?: AskWords; transport?: AskTransport | null; voiceStatus?: VoiceStatus | null; voiceTransport?: VoiceTransport | null; children: React.ReactNode }) {
  const session = useAskSession({ lang, base, words, availability, transport, voiceStatus, voiceTransport });
  return (
    <AskContext.Provider value={session}>
      {children}
      {session.live && !readOnly ? <AskFloating session={session} chipWords={chipWords ?? words} /> : null}
    </AskContext.Provider>
  );
}
