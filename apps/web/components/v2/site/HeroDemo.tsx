"use client";

import { Pause, Play } from "lucide-react";
import { useRef } from "react";

import { Orb } from "@/components/v2/Orb";
import { useAutoplay } from "@/components/v2/site/useAutoplay";

export type DemoSample = { code: string; label: string; shop: string; initials: string; caller: string; info: string; result: string; msgs: readonly string[] };
export type DemoWords = { tabs: string; assist: string; calling: string; note: string; pause: string; play: string };

/**
 * The picture beside the headline (job DM): four example conversations (a saree shop in Telugu, paver blocks in Hindi, a school in Kannada, tiles in English), each a WhatsApp chat on a phone and, over its corner, a call card
 * with the AI circle speaking. Every 5 seconds the next example comes up; touching a tab stops that for good (the visitor chose), a button pauses and plays it, and `prefers-reduced-motion` never starts it. Everything on it is
 * made up and says so (`note`). Each chat is drawn in its own `lang`. The words and the examples come from the server as props: this file holds no copy.
 */
export function HeroDemo({ samples, words }: { samples: readonly DemoSample[]; words: DemoWords }) {
  const { index, setIndex, paused, setPaused, reduced } = useAutoplay(samples.length, 5000);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (i: number, focus = false) => {
    setPaused(true);
    setIndex(i);
    if (focus) tabs.current[i]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = samples.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    pick(to, true);
  };
  const c = samples[index];
  return (
    <div className="flex min-w-0 flex-col items-center gap-4" data-part="hero-demo">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div role="tablist" aria-label={words.tabs} className="flex flex-wrap justify-center gap-2">
          {samples.map((x, i) => (
            <button
              key={x.code}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`demo-tab-${x.code}`}
              aria-selected={i === index}
              aria-controls="demo-panel"
              tabIndex={i === index ? 0 : -1}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${i === index ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        {reduced ? null : (
          <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-edge bg-surface text-ink hover:bg-surface-2">
            {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            <span className="sr-only">{paused ? words.play : words.pause}</span>
          </button>
        )}
      </div>
      <div role="tabpanel" id="demo-panel" aria-labelledby={`demo-tab-${c.code}`} lang={c.code} className="relative w-[300px] max-w-full pb-10 max-sm:pb-0">
        <div className="rounded-[36px] bg-[#1e1e24] p-2.5 shadow-[0_30px_60px_rgba(30,30,36,0.18)]">
          <div className="flex h-[430px] flex-col overflow-hidden rounded-[28px] bg-[#efe7dc] text-[#1e1e24]">
            <div className="flex items-center gap-2.5 border-b border-[#e7e3dc] bg-white px-4 py-3.5">
              <span className="flex size-[34px] items-center justify-center rounded-full bg-[#fff1e8] text-[13px] font-bold text-[#c2410c]">{c.initials}</span>
              <span className="flex min-w-0 flex-col">
                <strong className="truncate text-sm">{c.shop}</strong>
                <span className="text-xs text-[#6b6973]">{words.assist}</span>
              </span>
            </div>
            <div className="flex flex-col gap-2 px-3 pb-4 pt-3.5 text-sm leading-normal">
              {c.msgs.map((m, i) => (
                <p key={i} className={`m-0 max-w-[86%] px-3 py-2 ${i % 2 === 0 ? "self-start rounded-xl rounded-bl-sm bg-white" : "self-end rounded-xl rounded-br-sm bg-[#d9fdd3]"}`}>
                  {m}
                </p>
              ))}
              <p className="m-0 mt-1 self-center rounded-full bg-white px-2.5 py-0.5 text-[11px] text-[#6b6973]">{c.result}</p>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 flex w-[270px] max-w-[85%] items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 shadow-[0_18px_40px_rgba(30,30,36,0.12)] max-sm:static max-sm:mx-auto max-sm:mt-[-24px] max-sm:max-w-[300px]">
          <Orb px={48} state={reduced ? "still" : "speak"} />
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="text-sm">{words.calling.replace("{name}", c.caller)}</strong>
            <span className="text-xs text-muted">{c.info}</span>
            <span aria-hidden="true" className="orb-wave">
              {Array.from({ length: 12 }, (_, k) => (
                <span key={k} />
              ))}
            </span>
          </span>
        </div>
      </div>
      <p className="max-w-[300px] text-center text-xs text-muted">{words.note}</p>
    </div>
  );
}
