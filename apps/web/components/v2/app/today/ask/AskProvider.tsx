"use client";

import dynamic from "next/dynamic";
import * as React from "react";

import type { AskTransport, Availability, VoiceStatus, VoiceTransport } from "./ask-types";
import type { AskWords } from "./ask-words";
import { AskProvidedContext } from "./ask-store";
import { AskFloating } from "./AskFloating";

/** The conversation's code: a chunk of its own, loaded once the page is up (the route-JS budget counts what a page loads at first). */
const AskSessionHost = dynamic(() => import("./AskSessionHost").then((m) => m.AskSessionHost), { ssr: false });

/**
 * One conversation for the whole workspace (job DQ part 0): the tenant layout wraps the pages in this, so the thread, the streaming answer and the microphone survive moving from screen to screen (the layout stays mounted while the
 * pages change). Today draws it in the assistant's card (AskCard); every other screen draws the floating orb and its panel (AskFloating). `availability` is what the server knows: only "live" makes anything to ask with; `readOnly`
 * hides the orb (a read-only workspace asks nothing of the AI). The orb is light and on the page at once; the session it opens arrives as its own chunk (AskSessionHost, ask-store.ts).
 */
export function AskProvider({ lang, base, words, availability, readOnly = false, chipWords, transport, voiceStatus, voiceTransport, children }: { lang: string; base: string; words: AskWords; availability: Availability; readOnly?: boolean; /** The words of the suggestion chips for the screens (the server resolves them for the language and the business type). */ chipWords?: AskWords; transport?: AskTransport | null; voiceStatus?: VoiceStatus | null; voiceTransport?: VoiceTransport | null; children: React.ReactNode }) {
  const live = availability === "live";
  return (
    <AskProvidedContext.Provider value={true}>
      {live ? <AskSessionHost lang={lang} base={base} words={words} availability={availability} transport={transport} voiceStatus={voiceStatus} voiceTransport={voiceTransport} /> : null}
      {children}
      {live && !readOnly ? <AskFloating words={words} chipWords={chipWords ?? words} /> : null}
    </AskProvidedContext.Provider>
  );
}
