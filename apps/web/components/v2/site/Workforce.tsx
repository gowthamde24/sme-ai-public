"use client";

import { Pause, Play } from "lucide-react";

import { Orb } from "@/components/v2/Orb";
import { useAutoplay } from "@/components/v2/site/useAutoplay";
import { WORKER_ICONS } from "@/components/v2/app/mark/workers";

export type WorkerCard = { n: number; name: string; desc: string; act: string; early: boolean };
export type WorkforceWords = { live: string; list: string; pause: string; play: string; done: string; next: string; early: string };

/**
 * The six AI workers of the home page (job DM, from the approved design): a row of six cards on the dark band, in the order of the workflow. Every 2.6 seconds the next worker lights up (the one before is "handed over",
 * the ones after are "up next"), to show a lead moving from one worker to the next. It is an example, not a live feed: the pill says "In this example". The visitor can pause it; with `prefers-reduced-motion` it never starts and
 * the six cards are plain. The words come from the server as props: this file holds no copy.
 */
export function Workforce({ workers, words }: { workers: readonly WorkerCard[]; words: WorkforceWords }) {
  const { index, paused, setPaused, reduced } = useAutoplay(workers.length, 2600);
  const live = workers[index];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2.5 rounded-full border border-night-line bg-night-2 py-1.5 pl-1.5 pr-4 text-sm text-night-muted">
          <Orb px={26} state={reduced ? "still" : "ambient"} />
          <span>{words.live.replace("{name}", live.name)}</span>
        </span>
        {reduced ? null : (
          <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border-[1.5px] border-night-line text-on-night hover:bg-night-2">
            {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            <span className="sr-only">{paused ? words.play : words.pause}</span>
          </button>
        )}
      </div>
      <ol aria-label={words.list} className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-part="workers">
        {workers.map((w, i) => {
          const Icon = WORKER_ICONS[i];
          const state = reduced ? "plain" : i === index ? "on" : i < index ? "done" : "next";
          return (
            <li
              key={w.n}
              data-worker={w.n}
              data-state={state}
              aria-current={state === "on" ? "step" : undefined}
              className={`flex min-h-[200px] flex-col gap-2.5 rounded-2xl border p-5 motion-safe:transition-all motion-safe:duration-500 ${state === "on" ? "border-brand bg-night-2 shadow-[0_0_0_4px_rgba(255,119,60,0.10)] motion-safe:lg:-translate-y-2" : "border-night-line bg-night-2/70"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`flex size-10 items-center justify-center rounded-xl ${state === "on" ? "bg-brand text-ink" : "bg-night-line text-brand"}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-semibold text-night-muted" aria-hidden="true">
                  {String(w.n).padStart(2, "0")}
                </span>
              </div>
              <strong className="font-display text-lg font-bold leading-tight">{w.name}</strong>
              {w.early ? <span className="inline-flex self-start rounded-full bg-brand-bg px-2.5 py-0.5 text-xs font-extrabold text-brand-text">{words.early}</span> : null}
              <span className="text-sm leading-relaxed text-night-muted">{w.desc}</span>
              <span className="flex-1" />
              {state === "plain" ? null : (
                <span className="flex min-h-10 items-end border-t border-night-line pt-3 text-[13px] leading-snug">
                  {state === "on" ? (
                    <span className="flex items-center gap-2 font-semibold text-brand">
                      <span aria-hidden="true" className="inline-flex gap-[3px]">
                        <i className="size-[5px] rounded-full bg-brand motion-safe:animate-pulse" />
                        <i className="size-[5px] rounded-full bg-brand motion-safe:animate-pulse [animation-delay:150ms]" />
                        <i className="size-[5px] rounded-full bg-brand motion-safe:animate-pulse [animation-delay:300ms]" />
                      </span>
                      {w.act}
                    </span>
                  ) : state === "done" ? (
                    <span className="text-night-muted">{words.done}</span>
                  ) : (
                    <span className="text-night-muted">{words.next}</span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
