"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { callLines, type TemplateExample } from "@/lib/jobs/templates";

import type { Say } from "../../words";

/**
 * The live previews of a template card (mock r3-02): what the customer will see, with the shop's name already in it. Pure drawing: the text arrives filled (the data's own words, in the person's language); nothing here sends or plays anything
 * but the sample player, and that only when a recorded sample exists.
 */

/** The WhatsApp bubble: the shop's name above (a round initial, "Business account"), the message as the customer reads it. */
export function WaBubble({ business, text, t }: { business: string; text: string; t: Say }) {
  return (
    <div data-part="preview-whatsapp" className="flex flex-col gap-1.5 rounded-[12px] round-ok bg-(--jb-wa-bg) p-2.5">
      <p className="m-0 flex items-center gap-2 px-0.5 text-[13px] font-bold leading-tight text-(--jb-wa-ink)">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-[12px] font-bold text-on-brand">
          {business.trim().charAt(0).toUpperCase() || "S"}
        </span>
        <span className="min-w-0">
          {business}
          <span className="block text-[12px] font-medium text-(--jb-wa-meta)">{t("jobs.tpl.wa.sub")}</span>
        </span>
      </p>
      <p className="m-0 max-w-[94%] self-start whitespace-pre-line rounded-[2px_12px_12px_12px] round-ok bg-(--jb-wa-bubble) px-2.5 py-2 text-[14px] leading-[1.4] text-(--jb-wa-ink) shadow-[0_1px_1px_rgba(0,0,0,0.12)]">{text}</p>
    </div>
  );
}

/** The two lines the assistant says at the start of a call (the first always says it is an AI); a play button follows when a sample exists. */
export function CallSnippet({ assistant, text, t }: { assistant: string; text: string; t: Say }) {
  const lines = callLines(text);
  return (
    <div data-part="preview-call" className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      {lines.map((line, i) => (
        <p key={i} className="m-0 flex items-start gap-2.5 text-[14px] leading-[1.4] text-ink">
          <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-on-brand">
            {assistant.trim().charAt(0).toUpperCase() || "A"}
          </span>
          <span className="min-w-0">
            {i === 0 ? <span className="block text-[11.5px] font-semibold text-muted">{t("jobs.tpl.who.assistant")}</span> : null}
            {line}
          </span>
        </p>
      ))}
    </div>
  );
}

const BARS = 24;
const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The round play button with a small wave and the time: plays the recorded 10-second sample of the template. Drawn ONLY when the data has a sample (`sample_audio`); the sheet never draws a dead button. */
export function SamplePlayer({ src, t }: { src: string; t: Say }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [total, setTotal] = useState(10);
  useEffect(() => {
    const a = audio.current;
    return () => a?.pause();
  }, []);
  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setPlaying(false));
    else a.pause();
  }
  const done = Math.round((at / Math.max(total, 1)) * BARS);
  return (
    <div data-part="sample-player" data-on={playing ? "" : undefined} className={`flex items-center gap-3 rounded-md border bg-surface py-1.5 pl-1.5 pr-3.5 ${playing ? "border-brand-text" : "border-line"}`}>
      <button type="button" onClick={toggle} aria-label={t(playing ? "jobs.tpl.pause" : "jobs.tpl.play")} aria-pressed={playing} className="jb-press relative grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand">
        {playing ? <Pause aria-hidden="true" className="size-[18px] fill-current" /> : <Play aria-hidden="true" className="size-[18px] translate-x-px fill-current" />}
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="text-[13px] font-semibold leading-tight text-ink">{t("jobs.tpl.play")}</b>
        <span data-playing={playing ? "" : undefined} className="jb-wave flex h-5 items-center gap-0.5" aria-hidden="true">
          {Array.from({ length: BARS }, (_, k) => (
            <i key={k} className={`block h-full flex-1 origin-center rounded-sm ${k < done ? "bg-brand" : "bg-edge opacity-60"}`} />
          ))}
        </span>
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-muted">
        {fmt(at)} / {fmt(total)}
      </span>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setTotal(e.currentTarget.duration)}
      />
    </div>
  );
}

/** The example shops of a Lead Finder card, with the place and why it would fit. The invented ones are each labelled "Example" (never a real shop) and have a fit only in the mock; the workspace's REAL best prospects (`real`) wear no label and draw the fit the prospects API gave them. You contact them yourself, and the card says so. */
export function ExampleProspects({ examples, why, real = false, t }: { examples: readonly TemplateExample[]; why: (e: TemplateExample) => string; real?: boolean; t: Say }) {
  return (
    <div data-part="preview-examples" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      {examples.map((e) => (
        <div key={e.name} data-example={real ? "real" : ""} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-t border-line px-3 py-2.5 first:border-t-0">
          <b className="min-w-0 text-[14.5px] leading-snug text-ink">
            {e.name.replace(/\s*\(example\)\s*$/i, "")}
            {real ? null : <span className="ml-1.5 inline-block rounded bg-surface-2 px-2 py-px align-middle text-[11.5px] font-semibold text-muted">{t("jobs.tpl.example")}</span>}
          </b>
          {e.fit !== null ? (
            <span data-fit={e.fit} className="inline-flex h-6 items-center gap-1.5 self-start rounded border border-line bg-surface-2 px-2.5 text-[12.5px] font-bold text-ink">
              <i aria-hidden="true" className={`size-2 rounded-full ${e.fit >= 85 ? "bg-brand" : "bg-(--jb-wait-bg)"}`} />
              {t("jobs.tpl.fit", { n: e.fit })}
            </span>
          ) : null}
          <span className="col-span-2 text-[12.5px] text-muted">{e.area}</span>
          <span className="col-span-2 text-[13px] leading-snug text-ink">{why(e)}</span>
        </div>
      ))}
    </div>
  );
}
