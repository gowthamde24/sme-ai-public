"use client";

import dynamic from "next/dynamic";
import * as React from "react";

import type { AiMood } from "../../mark/mood";
import { AskAnswer, AskChips, AskForm, AskVoiceMode } from "./AskView";
import { DoItBar } from "./AskDoItLazy";
import { AskOff } from "./AskOff";
import { AskTeam } from "./AskTeam";
import type { Availability } from "./ask-types";
import type { AskWords } from "./ask-words";
import { AskProvidedContext, AskVoiceContext, useStoredAsk } from "./ask-store";

/** The chat in the card (where the spoken conversation is on): its own chunk. */
const ChatCard = dynamic(() => import("./ChatCardHost"), { ssr: false });

/**
 * The question line INSIDE Today's assistant card (job DQ part 0): the text box with the microphone and Send, the three chips under it, and the latest exchange below ("Show earlier" opens the rest of the thread). It draws the workspace's
 * shared conversation (AskProvider), so a question asked on another screen is here. Without a provider it makes a conversation of its own (the same line, no thread beyond this card).
 */
export function AskCard({ lang, base, availability, words, chips, onMood }: { lang: string; base: string; availability: Availability; words: AskWords; chips: readonly string[]; onMood: (mood: AiMood) => void }) {
  const provided = React.useContext(AskProvidedContext);
  const shared = useStoredAsk();
  const voice = React.useContext(AskVoiceContext);
  const mood = shared?.mood;
  React.useEffect(() => {
    if (mood) onMood(mood);
  }, [mood, onMood]);
  if (!provided) return <AskTeam variant="hero" lang={lang} base={base} availability={availability} words={words} onMood={onMood} chips={chips} />;
  // inside a workspace the conversation's code arrives as its own chunk: until it has, the line is drawn and nothing in it can be pressed (no dead button)
  if (!shared)
    return availability === "live" ? (
      <div data-ask="waiting" data-ask-where="card" aria-hidden="true" className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex min-h-12 min-w-0 flex-1 items-center rounded-full border border-edge bg-bg px-5 text-base text-muted md:min-h-14">{words["ask.placeholder.hero"] ?? ""}</div>
          <div className="size-12 shrink-0 rounded-full border border-edge bg-surface md:size-14" />
        </div>
        <ul className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c} className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-muted">
              {c}
            </li>
          ))}
        </ul>
      </div>
    ) : availability === "switched_off" ? (
      // first run: the workspace's own switch starts off, so the line is drawn where it will be, with the reason and (Owner, Admin) one button to turn it on
      <AskOff look="card" words={words} />
    ) : (
      <p data-ask="unavailable" className="text-base text-muted">
        {words["frame.notyet"] ?? ""}
      </p>
    );
  const w = shared.w;
  if (!shared.live)
    return (
      <p data-ask="unavailable" className="text-base text-muted">
        {availability === "switched_off" ? w("office.switchedoff") : w("frame.notyet")}
      </p>
    );
  if (voice) return <div data-ask="live" data-ask-where="card" className="min-h-48 min-w-0"><ChatCard session={shared} chips={chips} voice={voice} /></div>;
  return (
    <div data-ask="live" data-ask-where="card" className="flex min-w-0 flex-col gap-3">
      <AskForm session={shared} look="card" placeholder={shared.mode === "do" ? (shared.doIt?.words["tk.d.placeholder"] ?? w("ask.placeholder.hero")) : w("ask.placeholder.hero")} />
      {shared.doIt ? <DoItBar session={shared} /> : null}
      {shared.phase === "idle" && shared.mode !== "do" ? <AskChips session={shared} chips={chips} /> : null}
      <AskAnswer session={shared} chips={chips} earlierWord={w("ask.earlier")} />
      <AskVoiceMode session={shared} />
    </div>
  );
}
