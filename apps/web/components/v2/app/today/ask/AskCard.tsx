"use client";

import * as React from "react";

import type { AiMood } from "../../mark/mood";
import { AskAnswer, AskChips, AskForm, AskVoiceMode } from "./AskView";
import { AskTeam } from "./AskTeam";
import type { Availability } from "./ask-types";
import type { AskWords } from "./ask-words";
import { useSharedAsk } from "./AskProvider";

/**
 * The question line INSIDE Today's assistant card (job DQ part 0): the text box with the microphone and Send, the three chips under it, and the latest exchange below ("Show earlier" opens the rest of the thread). It draws the workspace's
 * shared conversation (AskProvider), so a question asked on another screen is here. Without a provider it makes a conversation of its own (the same line, no thread beyond this card).
 */
export function AskCard({ lang, base, availability, words, chips, onMood }: { lang: string; base: string; availability: Availability; words: AskWords; chips: readonly string[]; onMood: (mood: AiMood) => void }) {
  const shared = useSharedAsk();
  const mood = shared?.mood;
  React.useEffect(() => {
    if (mood) onMood(mood);
  }, [mood, onMood]);
  if (!shared) return <AskTeam variant="hero" lang={lang} base={base} availability={availability} words={words} onMood={onMood} chips={chips} />;
  const w = shared.w;
  if (!shared.live)
    return (
      <p data-ask="unavailable" className="text-base text-muted">
        {availability === "switched_off" ? w("office.switchedoff") : w("frame.notyet")}
      </p>
    );
  return (
    <div data-ask="live" data-ask-where="card" className="flex min-w-0 flex-col gap-3">
      <AskForm session={shared} look="card" placeholder={w("ask.placeholder.hero")} />
      {shared.phase === "idle" ? <AskChips session={shared} chips={chips} /> : null}
      <AskAnswer session={shared} chips={chips} earlierWord={w("ask.earlier")} />
      <AskVoiceMode session={shared} />
    </div>
  );
}
