"use client";

import dynamic from "next/dynamic";
import * as React from "react";

import { AskCard } from "./ask/AskCard";
import type { Availability } from "./ask/ask-types";
import type { AskWords } from "./ask/ask-words";
import { AskProvidedContext, AskVoiceContext, useStoredAsk } from "./ask/ask-store";

/** The chat in the bar: the same lazy chunk as the card's (the route-JS budget counts what Today loads at first). */
const ChatBar = dynamic(() => import("./ask/ChatCardHost"), { ssr: false });

const subscribe = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const q = window.matchMedia("(min-width: 768px)");
  q.addEventListener("change", notify);
  return () => q.removeEventListener("change", notify);
};
const desktopNow = () => typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 768px)").matches; // (no matchMedia: a test environment, which draws the desktop)

/**
 * The assistant's command bar on Today (desktop, owner 31 Oct): one compact bar under "Needs you" with the small orb, one line to write in, Dictate / Live / Send and the suggestion chips; no empty chat area. A conversation opens below the bar
 * (half the screen at most, scrolling inside) with a Minimise button. It draws the workspace's shared conversation (AskProvider), so a question asked on another screen is here. On a phone it is not drawn at all: the floating orb opens the same
 * chat as a sheet. Until the conversation's code has arrived, or where the assistant is off or not available, it falls back to the card's own states (the line drawn where it will be, the reason and the button that turns it on).
 */
export function CommandBar({ lang, base, availability, words, chips }: { lang: string; base: string; availability: Availability; words: AskWords; chips: readonly string[] }) {
  const provided = React.useContext(AskProvidedContext);
  const shared = useStoredAsk();
  const voice = React.useContext(AskVoiceContext);
  // a phone never mounts it (its chat is the floating orb's sheet: two chats at once would share ids and the microphone); until the browser says it is a desktop an empty bar of its own height stands in, so nothing jumps
  const desktop = React.useSyncExternalStore(subscribe, desktopNow, () => false);
  if (!desktop) return <div aria-hidden="true" data-part="command-bar" className="h-[10.5rem] rounded-2xl border border-line bg-surface max-md:hidden" />;
  if (provided && shared?.live && voice) {
    return (
      <section data-part="command-bar" aria-label={words["bv.chat.title"] ?? undefined} className="max-md:hidden">
        <div data-ask="live" data-ask-where="bar" className="min-w-0">
          <ChatBar session={shared} chips={chips} voice={voice} variant="bar" />
        </div>
      </section>
    );
  }
  return (
    <section data-part="command-bar" className="rounded-2xl border border-line bg-surface p-3 max-md:hidden">
      <AskCard lang={lang} base={base} availability={availability} words={words} chips={chips} onMood={() => undefined} />
    </section>
  );
}
