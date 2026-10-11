"use client";

import * as React from "react";

import { AgentOwl3D } from "../owl/AgentOwl3D";
import type { OwlMood } from "../owl/owl-mood";
import { AskTeam } from "./ask/AskTeam";
import type { AskWords } from "./ask/ask-words";
import type { Availability } from "./ask/ask-types";
import { useNeeds } from "./needs-store";
import { say, type TodayWords } from "./today-words";
import type { Digest } from "./types";

/** The overnight line: what the outbox did in the last 24 hours, from the log (read under its own Suspense: the card does not wait for it). Nothing is drawn for a person who may not read the log. */
function Overnight({ digest, words }: { digest: Promise<Digest>; words: TodayWords }) {
  const d = React.use(digest);
  if (d.state === "none") return null;
  const text = d.state === "error" ? say(words, "today.over.notyet") : d.sent === 0 && d.held === 0 ? say(words, "today.over.none") : say(words, "today.over.some", { sent: d.sent, held: d.held });
  return <p data-part="overnight" className="text-sm text-muted md:max-w-[60ch] md:text-base">{text}</p>;
}

function Headline({ words }: { words: TodayWords }) {
  const { total } = useNeeds();
  const text = total === null ? say(words, "frame.notyet") : total === 0 ? say(words, "today.hero.none") : total === 1 ? say(words, "today.hero.one") : say(words, "today.hero.other", { n: total });
  return (
    <h2 id="agent-owl-heading" className="font-display text-[21px] font-semibold leading-tight tracking-[-0.01em] [overflow-wrap:anywhere] md:text-[32px] md:leading-[1.15]">
      {text}
    </h2>
  );
}

/**
 * The Agent OWL card of Today (job AU): the 3D owl and a mood pill on the left (the flat owl wherever the 3D one is not allowed, see AgentOwl3D); on the right the name, ONE sentence built from the real
 * list ("3 things need you. The rest is handled." / "Nothing needs you right now."), the overnight line from the outbox log, the Ask box and three suggestion chips. The owl's mood follows the Ask box
 * (typing, the microphone, the request, the streaming answer, a refusal), exactly as before. On a phone the card is compact (the owl beside the sentence) and the question line is fixed above the
 * bottom bar; the answer opens under the card, full width.
 */
export function AgentHero({ lang, base, availability, askWords, words, chips, digest }: { lang: string; base: string; availability: Availability; askWords: AskWords; words: TodayWords; chips: readonly string[]; digest: Promise<Digest> | null }) {
  const [mood, setMood] = React.useState<OwlMood>(availability === "live" ? "idle" : "resting");
  const moodText = say(words, `owl.mood.${mood}`);
  const resting = mood === "resting";
  const pill = (
    <span aria-hidden="true" className="inline-flex min-h-8 items-center gap-2 rounded-full bg-surface-2 px-3.5 text-sm font-semibold">
      <span className={`size-2 rounded-full ${resting ? "bg-muted" : "bg-green-text"}`} />
      {moodText}
    </span>
  );
  return (
    <section aria-labelledby="agent-owl-heading" data-part="agent-owl" className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-3xl border border-line bg-surface p-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-x-8 md:gap-y-4 md:rounded-[28px] md:p-8">
      <div className="flex flex-col items-center gap-3 md:row-span-2 md:self-center">
        <AgentOwl3D mood={mood} name={say(words, "agent.main")} moodText={moodText} className="md:size-[220px]" />
        <span className="max-md:hidden">{pill}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 md:gap-4 md:self-end">
        <span className="md:hidden">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
            <span aria-hidden="true" className={`size-2 rounded-full ${resting ? "bg-muted" : "bg-green-text"}`} />
            <span aria-hidden="true">{moodText}</span>
          </span>
        </span>
        <p className="text-sm font-bold uppercase tracking-[0.04em] text-brand-text max-md:hidden">{say(words, "agent.main")}</p>
        <Headline words={words} />
        {digest ? (
          <React.Suspense fallback={<span aria-hidden="true" className="block h-5 w-2/3 animate-pulse rounded bg-surface-2" />}>
            <Overnight digest={digest} words={words} />
          </React.Suspense>
        ) : null}
      </div>
      <div className="col-span-2 flex min-w-0 flex-col gap-3 md:col-span-1 md:col-start-2 md:self-start">
        <AskTeam variant="hero" lang={lang} base={base} availability={availability} words={askWords} onMood={setMood} chips={chips} />
        <p className="text-sm text-muted max-md:hidden">{say(words, "ask.hero.note")}</p>
      </div>
    </section>
  );
}
