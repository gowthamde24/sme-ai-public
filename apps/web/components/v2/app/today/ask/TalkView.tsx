"use client";

import dynamic from "next/dynamic";
import * as React from "react";

import { AskCard } from "./LazyAskCard";
import { AskProvidedContext, AskVoiceContext, useStoredAsk } from "./ask-store";
import type { Availability } from "./ask-types";
import type { AskWords } from "./ask-words";

const ChatCard = dynamic(() => import("./ChatCardHost"), { ssr: false, loading: () => <div aria-hidden="true" className="min-h-[24rem] rounded-2xl border border-line bg-surface" /> });

/**
 * "Talk to assistant" as a page of its own (owner rule, 6 Nov 2026: every menu item opens its own page): the same conversation as Today's composer and the floating panel (ONE session for the workspace, so a chat started here goes on there),
 * drawn in full: the orb, the conversation, "+" (Add a file, Earlier conversations, New conversation), the language pill, the microphone, and the chips. Where the chat is not live here, the Ask box of before; an assistant that is not
 * built says so in a sentence (never "Not available yet").
 */
export function TalkView({ lang, base, availability, words, chips }: { lang: string; base: string; availability: Availability; words: AskWords; chips: readonly string[] }) {
  const provided = React.useContext(AskProvidedContext);
  const shared = useStoredAsk();
  const voice = React.useContext(AskVoiceContext);
  if (availability === "not_available") return <p className="text-base text-muted">{words["ask.off.line"] ?? ""}</p>;
  if (provided && shared?.live && voice) {
    return (
      <section id="ask" data-part="talk" aria-label={words["bv.chat.title"] ?? undefined} className="min-w-0">
        <ChatCard session={shared} chips={chips} voice={voice} variant="card" />
      </section>
    );
  }
  return (
    <section id="ask" data-part="talk" className="rounded-2xl border border-line bg-surface p-3">
      <AskCard lang={lang} base={base} availability={availability} words={words} chips={chips} onMood={() => undefined} />
    </section>
  );
}
