"use client";

import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";

import type { OwlAgent } from "@/components/v2/app/owl/owl-files";
import { useAutoplay } from "@/components/v2/site/useAutoplay";

export type HowStep = { n: string; /** The helper that does this step (an owl id) and its name. */ owl: OwlAgent; /** The helper's picture, drawn on the server (a client file that imported the owl module would carry its whole rig). */ picture: ReactNode; helper: string; title: string; text: string; you: string };
export type HowWords = { list: string; pause: string; play: string };

/** The progress bar's width after step 1 to 6 (whole classes, so Tailwind sees each one and the element needs no inline style). */
const FILL = ["w-1/6", "w-2/6", "w-3/6", "w-4/6", "w-5/6", "w-full"] as const;

/**
 * The six steps of the home page (job CX, one helper owl on each since job CZ): a progress bar and six cards, and every 2.2 seconds the next card lifts and darkens (`aria-current="step"` on it, the bar fills to it), round and round. With
 * `prefers-reduced-motion` nothing moves, nothing is marked and all six read the same: the highlight classes are `motion-safe:` only, so a visitor who asked for less motion sees a still list. A pause button is
 * there for anyone else who finds it distracting (WCAG 2.2.2). The words come from the server as props: this file holds no copy.
 */
export function HowSteps({ steps, words }: { steps: readonly HowStep[]; words: HowWords }) {
  const { index, paused, setPaused, reduced, playing } = useAutoplay(steps.length, 2200);
  const active = reduced ? -1 : index;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2 motion-reduce:hidden">
          <div className={`h-1.5 rounded-full bg-brand transition-[width] duration-500 ease-out ${FILL[Math.min(index, FILL.length - 1)]}`} />
        </div>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          aria-pressed={paused}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-ink hover:bg-surface-2 motion-reduce:hidden"
        >
          {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
          <span className="sr-only">{paused ? words.play : words.pause}</span>
        </button>
      </div>
      <ol aria-label={words.list} data-playing={playing ? "true" : "false"} className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-6">
        {steps.map((s, i) => {
          const on = i === active;
          return (
            <li
              key={s.n}
              aria-current={on ? "step" : undefined}
              data-step={s.n}
              data-owl={s.owl}
              className={`flex gap-3 rounded-2xl border p-4 transition-[transform,box-shadow,background-color] duration-300 motion-reduce:transition-none min-[480px]:flex-col ${
                on ? "border-night bg-night text-on-night shadow-[var(--v2-shadow-pop)] motion-safe:-translate-y-1.5" : "border-line bg-surface text-ink"
              }`}
            >
              <div className="flex shrink-0 items-start justify-between gap-2 min-[480px]:items-end">
                {s.picture}
                <span aria-hidden="true" className={`font-display text-3xl font-extrabold leading-none max-[479px]:hidden ${on ? "text-brand" : "text-muted"}`}>
                  {s.n}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <strong className="text-lg leading-tight">
                  <span aria-hidden="true" className={`mr-1.5 font-display font-extrabold min-[480px]:hidden ${on ? "text-brand" : "text-muted"}`}>
                    {s.n}
                  </span>
                  {s.title}
                </strong>
                <span className={`text-sm font-bold ${on ? "text-brand" : "text-brand-text"}`}>{s.helper}</span>
                <span className={`text-sm ${on ? "text-night-muted" : "text-muted"}`}>{s.text}</span>
                <span className={`text-sm font-bold ${on ? "text-brand" : "text-muted"}`}>{s.you}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
