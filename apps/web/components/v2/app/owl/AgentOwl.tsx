"use client";

import { PlushOwl } from "./PlushOwl";
import type { OwlMood } from "./owl-mood";

/**
 * Agent OWL where it talks to the person (the landing page, the Today card, the Ask box): the plush owlet in the mood the Ask box gives it. About 160 px on a laptop and 120 px on a phone, in a square box of that size
 * from the first paint (the still picture stands in until the layers arrive, so nothing moves). It is an image with a name and the mood, and the mood is also text for a screen reader (job CI replaced the 3D owl,
 * which needed three.js, with this: the same props, the same moods).
 */
export function AgentOwl({ mood, name, moodText, className = "", priority = false }: { mood: OwlMood; name: string; moodText: string; className?: string; /** The first thing on the page: its still picture is fetched at once (landing hero, Today card). */ priority?: boolean }) {
  return (
    <>
      <PlushOwl mood={mood} priority={priority} sizes="(min-width: 640px) 160px, 120px" label={`${name}, ${moodText}`} className={`size-[120px] shrink-0 sm:size-40 ${className}`} />
      <span aria-live="polite" className="sr-only">
        {moodText}
      </span>
    </>
  );
}
