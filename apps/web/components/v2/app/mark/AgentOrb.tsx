import { Orb } from "@/components/v2/Orb";

import { orbStateOf } from "./AgentMark";
import type { AiMood } from "./mood";

/**
 * The main assistant where it talks to the person (the Today card, the Ask box; job DM, replacing the owl): the AI circle in the state the Ask box gives it, with the halo while it answers. Large on a laptop, smaller on a phone.
 * It carries the name and the mood as text for a screen reader (the mood line is also a polite live region), like the owl before it. A server component with no script.
 */
export function AgentOrb({ mood, name, moodText, className = "", analyser = null }: { mood: AiMood; name: string; moodText: string; className?: string; /** The sound the circle follows (the microphone or the voice), if a client part hands it in. */ analyser?: AnalyserNode | null }) {
  const state = orbStateOf(mood);
  const halo = state === "speak";
  return (
    <>
      <span role="img" aria-label={`${name}, ${moodText}`} data-mood={mood} className={`inline-flex shrink-0 items-center justify-center ${className}`}>
        <span className="md:hidden">
          <Orb px={88} state={state} halo={halo} analyser={analyser} />
        </span>
        <span className="hidden md:inline-flex">
          <Orb px={140} state={state} halo={halo} analyser={analyser} />
        </span>
      </span>
      <span aria-live="polite" className="sr-only">
        {moodText}
      </span>
    </>
  );
}
