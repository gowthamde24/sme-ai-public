"use client";

import * as React from "react";

import { AgentOrb } from "../../mark/AgentOrb";
import { useAnalyser } from "./audio-level";
import type { AiMood } from "../../mark/mood";
import { AskAnswer, AskChips, AskForm, AskVoiceMode } from "./AskView";
import { AskCapabilities } from "./AskCapabilities";
import type { AskTransport, Availability, VoiceStatus, VoiceTransport } from "./ask-types";
import type { AskWords } from "./ask-words";
import { useAskSession } from "./use-ask-session";

export { insideWorkspace } from "./use-ask-session";

const card = "rounded-xl border border-line bg-surface shadow-[var(--v2-shadow)]";

/**
 * "Ask your team": a question to the assistant, answered from the workspace's own records. The answer streams in as plain text, with the screens it came from as links; anything the assistant prepared is shown as a DRAFT card whose
 * "Approve" opens the screen that decides (nothing is approved, sent or recorded from here). The microphone (job BF) records the question in the browser (tap to start and tap to stop, or hold on a phone; at most 60 seconds,
 * with a countdown and a Cancel) and sends the recording to the voice route: what it heard is shown as the person's own message, then the written answer, and the spoken answer when one was asked for. It is drawn only when
 * the API says voice is on and the browser can record: no dead button. While there is nothing to ask (it is not built, its switch is off, or the answer stream does not exist yet) the box says so and offers nothing to press.
 *
 * This is the box with its OWN session. Since job DQ part 0 the screens share one conversation instead (AskProvider, AskCard on Today, the floating panel of the other screens): this component stays for a place with no provider
 * and for the tests of the box. `hero` is only the question line, the chips and the answer (no title, no bar fixed to the screen: the line sits where it is drawn).
 */
export function AskTeam({ lang, base, words, availability, transport, voiceStatus, voiceTransport, variant = "box", onMood, chips: chipTexts }: { lang: string; base: string; words: AskWords; availability: Availability; transport?: AskTransport | null; voiceStatus?: VoiceStatus | null; voiceTransport?: VoiceTransport | null; /** `box`: the card with the circle in its header. `hero`: only the question line, the chips and the answer. */ variant?: "box" | "hero"; onMood?: (mood: AiMood) => void; /** The suggestion chips, when the caller chooses them (`hero`: three). */ chips?: readonly string[] }) {
  const s = useAskSession({ lang, base, words, availability, transport, voiceStatus, voiceTransport });
  const { w, mood } = s;
  const analyser = useAnalyser();
  React.useEffect(() => {
    onMood?.(mood);
  }, [mood, onMood]);
  const hero = variant === "hero";
  if (!s.live) {
    if (hero)
      return (
        <p data-ask="unavailable" className="text-base text-muted">
          {availability === "switched_off" ? w("office.switchedoff") : w("frame.notyet")}
        </p>
      );
    return (
      <section aria-labelledby="ask-heading" data-ask="unavailable" className={`${card} mx-auto mb-8 max-w-3xl p-4 sm:p-5`}>
        <div className="flex items-center gap-3 sm:gap-4">
          <AgentOrb mood={mood} name={w("agent.main")} moodText={w(`owl.mood.${mood}`)} analyser={analyser} />
          <div className="min-w-0">
            <h2 id="ask-heading" className="font-display text-xl font-semibold leading-tight">
              {w("ask.title")}
            </h2>
            <p className="text-sm text-muted">{availability === "switched_off" ? w("office.switchedoff") : w("frame.notyet")}</p>
          </div>
        </div>
      </section>
    );
  }
  const chips = chipTexts ?? [w("ask.chip.needs"), w("ask.chip.quotes"), w("ask.chip.money"), w("ask.chip.team")];
  const earlierWord = w("ask.earlier");
  if (hero)
    return (
      <div data-ask="live" className="flex min-w-0 flex-col gap-3">
        <AskForm session={s} look="card" placeholder={w("ask.placeholder.hero")} />
        {s.phase === "idle" ? <AskChips session={s} chips={chips} /> : null}
        <AskAnswer session={s} chips={chips} earlierWord={earlierWord} />
        <AskVoiceMode session={s} />
      </div>
    );
  return (
    <section aria-labelledby="ask-heading" data-ask="live" className={`${card} mx-auto mb-8 max-w-3xl p-4 sm:p-5`}>
      <div className="flex items-center gap-3 sm:gap-4">
        <AgentOrb mood={mood} name={w("agent.main")} moodText={w(`owl.mood.${mood}`)} analyser={analyser} />
        <div className="min-w-0">
          <h2 id="ask-heading" className="font-display text-xl font-semibold leading-tight">
            {w("ask.title")}
          </h2>
          <p className="text-sm text-muted">{w("ask.sub")}</p>
        </div>
      </div>
      <AskForm session={s} look="box" placeholder={w("ask.placeholder")} />
      {s.phase === "idle" ? <AskChips session={s} chips={chips} className="mt-3" /> : null}
      <AskCapabilities w={w} examples={[w("ask.chip.needs"), w("ask.chip.quotes"), w("ask.chip.team")]} onTry={(q) => void s.ask(q)} guideHref={`${base}/help/today`} />
      <div className="mt-4">
        <AskAnswer session={s} chips={chips} earlierWord={earlierWord} />
      </div>
      <AskVoiceMode session={s} />
    </section>
  );
}
