"use client";

import dynamic from "next/dynamic";
import * as React from "react";

import type { AskTransport, Availability, VoiceStatus, VoiceTransport } from "./ask-types";
import type { AskWords } from "./ask-words";
import { AskProvidedContext } from "./ask-store";
import { AskFloating } from "./AskFloating";
import { AskTurnOnContext, type TurnOn } from "./ask-turn-on";
import type { DoItOptions } from "./use-do-it";
import type { BrowserVoice } from "./browser-voice";

/** The conversation's code: a chunk of its own, loaded once the page is up (the route-JS budget counts what a page loads at first). */
/** The orb of an assistant that is switched off, and the line it opens: a chunk of its own too (the route-JS budget counts what a page loads at first). */
const AskOffFloating = dynamic(() => import("./AskOffFloating").then((m) => m.AskOffFloating), { ssr: false });
const AskSessionHost = dynamic(() => import("./AskSessionHost").then((m) => m.AskSessionHost), { ssr: false });

/**
 * One conversation for the whole workspace (job DQ part 0): the tenant layout wraps the pages in this, so the thread, the streaming answer and the microphone survive moving from screen to screen (the layout stays mounted while the
 * pages change). Today draws it in the assistant's card (AskCard); every other screen draws the floating orb and its panel (AskFloating). `availability` is what the server knows: only "live" makes anything to ask with; `readOnly`
 * hides the orb (a read-only workspace asks nothing of the AI). `turnOn` is the button of an assistant that is switched off (the Owner and Admin have it; null = this person may not): the card and the orb then draw the line where it will be, with that button (AskOff). The orb is light and on the page at once; the session it opens arrives as its own chunk (AskSessionHost, ask-store.ts).
 */
export function AskProvider({ lang, base, words, availability, readOnly = false, chipWords, transport, voiceStatus, voiceTransport, doIt, turnOn = null, voice, children }: { lang: string; base: string; words: AskWords; availability: Availability; readOnly?: boolean; /** The words of the suggestion chips for the screens (the server resolves them for the language and the business type). */ chipWords?: AskWords; transport?: AskTransport | null; voiceStatus?: VoiceStatus | null; voiceTransport?: VoiceTransport | null; /** Night 4 (tasks): present only when "Ask Vijaya to do it" is on and the person may make a plan. */ doIt?: DoItOptions | null; turnOn?: TurnOn | null; /** "Talk to your assistant" (BROWSER_VOICE, job DV): present only where the flag is on and the person may use it; the floating orb then opens the voice chat. */ voice?: BrowserVoice | null; children: React.ReactNode }) {
  const live = availability === "live";
  return (
    <AskProvidedContext.Provider value={true}>
      <AskTurnOnContext.Provider value={turnOn}>
      {live ? <AskSessionHost lang={lang} base={base} words={words} availability={availability} transport={transport} voiceStatus={voiceStatus} voiceTransport={voiceTransport} doIt={voice ? null : doIt} /> : null}
      {children}
      {live && !readOnly ? <AskFloating words={words} chipWords={chipWords ?? words} voice={voice} /> : null}
      {availability === "switched_off" && !readOnly ? <AskOffFloating words={words} /> : null}
      </AskTurnOnContext.Provider>
    </AskProvidedContext.Provider>
  );
}
