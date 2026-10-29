"use client";

import { ChatPanel } from "./ChatPanel";
import type { BrowserVoice } from "./browser-voice";
import type { AskSession } from "./use-ask-session";

/** Today's card, where the spoken conversation is on: the same chat as the floating panel, drawn in the card's place, in ONE lazy chunk (the route-JS budget counts what Today loads at first). */
export default function ChatCardHost({ session, chips, voice }: { session: AskSession; chips: readonly string[]; voice: BrowserVoice }) {
  return <ChatPanel variant="card" session={session} chips={chips} voice={voice} onClose={() => undefined} />;
}
