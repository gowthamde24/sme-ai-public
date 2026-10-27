"use client";

import { useEffect, useState } from "react";

import { useMedia } from "@/components/v2/landing/hooks";

export type HeroCallLine = { who: "v" | "c"; te: string; en: string };
export type HeroCallWords = { label: string; name: string; business: string; speaking: string; result: string; note: string };

const clock = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const FIRST = 700;
const GAP = 2600;
const HOLD = 5200;

/**
 * The one moving part of the home page: an example call (job landing v3). The assistant's and the customer's lines come up one by one, each in Telugu with the English under it, a clock runs, and when the call ends the result
 * is shown; after a pause it begins again. The server draws the whole call (so a page without script, a crawler and "reduce motion" see it all, with the clock at its end); the browser starts it over once the page is up, and
 * never for a visitor who asked for less motion. No button: nothing here asks to be paused. The names are made up and `note` says so. `seconds` is how long the call lasted. The lines come from lib/site/home-v3.ts.
 */
export function HeroCall({ lines, words, seconds }: { lines: readonly HeroCallLine[]; words: HeroCallWords; seconds: number }) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const [shown, setShown] = useState(lines.length);
  const [secs, setSecs] = useState(seconds);
  const [done, setDone] = useState(true);
  useEffect(() => {
    if (reduced) return; // nothing runs: the call is shown whole (below)
    const timers: ReturnType<typeof setTimeout>[] = [];
    let tick: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      setShown(0);
      setSecs(0);
      setDone(false);
      clearInterval(tick);
      tick = setInterval(() => setSecs((s) => s + 1), 1000);
      lines.forEach((_, i) => timers.push(setTimeout(() => setShown(i + 1), FIRST + i * GAP)));
      const end = FIRST + lines.length * GAP;
      timers.push(
        setTimeout(() => {
          clearInterval(tick);
          setSecs(seconds);
          setDone(true);
        }, end),
      );
      timers.push(setTimeout(run, end + HOLD));
    };
    run();
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(tick);
    };
  }, [reduced, lines, seconds]);
  // a visitor who asked for less motion sees the whole call, the clock at its end and the result, whatever the timers did
  const nShown = reduced ? lines.length : shown;
  const clockSecs = reduced ? seconds : secs;
  const finished = reduced || done;
  return (
    <div data-part="hero-call" className="relative mt-[300px] w-[min(420px,100%)] rounded-[28px] bg-night p-[22px] pb-[18px] text-on-night shadow-[0_30px_60px_-20px_rgba(23,22,28,0.45)] max-lg:-mt-14">
      <div className="flex items-center justify-between gap-3 text-sm text-night-muted">
        <div>
          <b className="block text-[17px] font-semibold text-on-night">{words.name}</b>
          {words.business}
        </div>
        <span className="inline-flex items-center gap-2 font-semibold tabular-nums text-brand">
          <i aria-hidden="true" className="size-2 rounded-full bg-brand" />
          <span data-part="clock">{clock(clockSecs)}</span>
        </span>
      </div>
      <div aria-live="polite" aria-label={words.label} className="mt-4 flex min-h-[212px] flex-col gap-2.5">
        {lines.map((l, i) => (
          <p
            key={i}
            lang="te"
            data-line={l.who}
            className={`m-0 max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-normal transition-[opacity,transform] duration-500 motion-reduce:transition-none ${l.who === "v" ? "rounded-tl-md bg-white/10" : "self-end rounded-tr-md bg-brand/20"} ${i < nShown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0"}`}
          >
            {l.te}
            <small lang="en" className="mt-0.5 block text-[12.5px] text-night-muted">
              {l.en}
            </small>
          </p>
        ))}
      </div>
      <div className="mt-3.5 flex justify-between gap-2.5 border-t border-white/10 pt-3.5 text-sm text-night-muted">
        <span>{words.speaking}</span>
        <span data-part="call-result" className="font-semibold text-[#7be0a9]">
          {finished ? words.result : " "}
        </span>
      </div>
      <p className="mt-2 text-xs text-night-muted">{words.note}</p>
    </div>
  );
}
