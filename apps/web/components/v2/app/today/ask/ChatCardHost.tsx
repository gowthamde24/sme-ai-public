"use client";

import { ChatPanel } from "./ChatPanel";
import type { BrowserVoice } from "./browser-voice";
import type { AskSession } from "./use-ask-session";

/** Today's card, where the spoken conversation is on: the same chat as the floating panel, drawn in the card's place, in ONE lazy chunk (the route-JS budget counts what Today loads at first). */
export default function ChatCardHost({ session, chips, voice, variant = "card" }: { session: AskSession; chips: readonly string[]; voice: BrowserVoice; /** `bar`: Today's command bar (the same chat in one compact row). */ variant?: "card" | "bar" }) {
  return <ChatPanel variant={variant} session={session} chips={chips} voice={voice} onClose={() => undefined} />;
}
