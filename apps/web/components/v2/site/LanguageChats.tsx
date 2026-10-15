"use client";

import { Pause, Play } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useAutoplay } from "@/components/v2/site/useAutoplay";

export type SampleChat = { code: string; label: string; shop: string; q: string; a: string; tag: string; q2: string };
export type ChatWords = { tabs: string; panel: string; online: string; note: string; pause: string; play: string };

/**
 * The sample chats of the home page's dark band (job CX): four language tabs (a real tablist: arrow keys, Home and End move between them) and a phone showing that language's sample chat. Every 4 seconds the next
 * language comes up; touching a tab stops the slide for good (the visitor chose), a button pauses and plays it, and `prefers-reduced-motion` never starts it. Each chat is drawn in its own `lang`, so a screen reader
 * says it in that language. The phone is a picture of WhatsApp, so its colours do not follow the theme. The words and the chats come from the server as props: this file holds no copy.
 */
export function LanguageChats({ chats, words, children }: { chats: readonly SampleChat[]; words: ChatWords; /** The heading and the line under it (drawn on the server), shown above the tabs. */ children: ReactNode }) {
  const { index, setIndex, paused, setPaused, reduced } = useAutoplay(chats.length, 4000);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (i: number, focus = false) => {
    setPaused(true);
    setIndex(i);
    if (focus) tabs.current[i]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = chats.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    pick(to, true);
  };
  const c = chats[index];
  return (
    <>
      <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
        {children}
        <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={words.tabs} className="flex flex-wrap gap-2">
          {chats.map((x, i) => (
            <button
              key={x.code}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`chat-tab-${x.code}`}
              aria-selected={i === index}
              aria-controls="chat-panel"
              tabIndex={i === index ? 0 : -1}
              lang={x.code}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={`min-h-11 rounded-full border-[1.5px] px-5 text-base ${i === index ? "border-brand bg-brand font-extrabold text-on-brand" : "border-night-line bg-transparent font-bold text-on-night hover:bg-night-2"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        {reduced ? null : (
          <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border-[1.5px] border-night-line text-on-night hover:bg-night-2">
            {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            <span className="sr-only">{paused ? words.play : words.pause}</span>
          </button>
        )}
        </div>
      </div>
      <figure className="m-0 flex w-[320px] max-w-full flex-none flex-col" data-part="chat-phone">
        <div role="tabpanel" id="chat-panel" aria-labelledby={`chat-tab-${c.code}`} aria-label={words.panel} lang={c.code} className="rounded-[40px] bg-[#0d0c10] p-3 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
          <div className="flex min-h-[360px] flex-col overflow-hidden rounded-[30px] bg-[#efe7dc]">
            <div className="flex flex-col bg-[#1f6f5c] px-4 py-3.5 leading-tight text-white">
              <strong className="text-[15px]">{c.shop}</strong>
              <span className="text-xs text-white/85">{words.online}</span>
            </div>
            <div className="flex flex-col gap-2.5 px-3 pb-5 pt-4 text-[15px] leading-normal text-[#1e1e24]">
              <p className="m-0 max-w-[86%] self-end rounded-xl rounded-br-sm bg-[#d9fdd3] px-3 py-2">{c.q}</p>
              <p className="m-0 max-w-[88%] self-start rounded-xl rounded-bl-sm bg-white px-3 py-2">
                {c.a}
                <span className="mt-1 block text-[11px] text-[#5b5a63]">{c.tag}</span>
              </p>
              <p className="m-0 max-w-[70%] self-end rounded-xl rounded-br-sm bg-[#d9fdd3] px-3 py-2">{c.q2}</p>
            </div>
          </div>
        </div>
        <figcaption className="pt-2 text-center text-xs text-night-muted">{words.note}</figcaption>
      </figure>
    </>
  );
}
