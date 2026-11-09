"use client";

import Link from "next/link";
import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import type { Helper, Standup } from "@/lib/api/ai-team";
import { buildSteps, stepAt, wordAt, wordsOf, type Reporter } from "@/lib/aiteam/standup-steps";

import { fill } from "./shift";
import { useReadAlong } from "./useReadAlong";

export type RemakeFn = (date: string) => Promise<{ ok: true; standup: Standup } | { ok: false; error: "limit" | "forbidden" | "signin" | "failed" }>;

/**
 * Where the six helpers sit: on an ellipse round the assistant, in a picture of 1000 x 640 whose parts are all in percent, so a phone shows the same scene smaller (like the landing page). x, y, width of the orb, in % of the picture.
 * Sides, then back row, then front row: the more of them there are, the later a slot is filled.
 */
const SLOTS: readonly { x: number; y: number; size: number }[] = [
  { x: 15, y: 54.7, size: 9 },
  { x: 29.9, y: 73.3, size: 10.5 },
  { x: 29.9, y: 36.1, size: 8 },
  { x: 70.1, y: 36.1, size: 8 },
  { x: 70.1, y: 73.3, size: 10.5 },
  { x: 85, y: 54.7, size: 9 },
];
const CENTRE = { x: 50, y: 25 };
const VIEW = { w: 1000, h: 640 };

const SPHERE = "bg-[radial-gradient(circle_at_34%_28%,#f6d2bc_0%,#b9715a_28%,#5a2c22_58%,#1f0f0c_100%)]";

/**
 * The stand-up page's picture and words (app v4 part 7, from app-Standup.png): the assistant in the middle, the helpers on an ellipse round it, "{Helper} is reporting" and the words of that step large, the steps as a bar under it,
 * "Hear the stand-up" and the day it is for. The words are the API's own lines (never made by a model here), grouped by helper; while the sound plays the step follows it and the word being read is marked (an estimate from the
 * sound's length, only to follow with the eye). Without sound a person steps through with the bar. Nothing here changes anything.
 */
export function StandupScene({ base, date, isToday, initial, words, helperNames, orbs, remake, dayLabel, timeLabel }: { base: string; date: string; isToday: boolean; initial: Standup | null; words: Readonly<Record<string, string>>; /** helper key -> name in the person's language */ helperNames: Readonly<Record<string, string>>; /** the helpers drawn round the assistant (the business's own six) */ orbs: readonly Helper[]; remake: RemakeFn | null; dayLabel: string; /** the clock the stand-up was made at, "09:00" */ timeLabel: string | null }) {
  const w = (k: string, vars?: Record<string, string>) => fill(words[k] ?? k, vars);
  const [standup, setStandup] = React.useState(initial);
  const [picked, setPicked] = React.useState(0);
  const [making, setMaking] = React.useState(false);
  const [note, setNote] = React.useState<"limit" | "failed" | null>(null);
  const steps = React.useMemo(() => buildSteps(standup?.lines ?? []), [standup]);
  const sound = useReadAlong(steps.reduce((n, s) => n + s.text.length, 0));
  const at = sound.playing || sound.fraction > 0 ? stepAt(steps, sound.fraction) : null;
  const index = Math.min(at?.index ?? picked, Math.max(0, steps.length - 1));
  const step = steps[index] ?? null;
  const nameOf = (who: Reporter) => (who === "everyone" ? w("aiteam.v4.everyone") : (helperNames[who] ?? who));
  const parts = React.useMemo(() => (step ? wordsOf(step.text) : []), [step]);
  const marked = at && step ? wordAt(parts, at.within) : -1;
  const speaker: Reporter | null = step?.who ?? null;

  const again = async () => {
    if (!remake || making) return;
    setMaking(true);
    setNote(null);
    const r = await remake(date);
    setMaking(false);
    if (r.ok) {
      sound.reset();
      setPicked(0);
      setStandup(r.standup);
    } else setNote(r.error === "limit" ? "limit" : "failed");
  };
  const ask = `${base}/talk?${new URLSearchParams({ ask: fill(words["aiteam.standup.ask.text"] ?? "", { date: `${date.slice(8, 10)}/${date.slice(5, 7)}` }) }).toString()}`;
  const slotOf = (h: Helper) => {
    const i = orbs.indexOf(h);
    return i >= 0 && i < SLOTS.length ? SLOTS[i] : null;
  };
  const from = speaker && speaker !== "everyone" ? slotOf(speaker) : null;

  return (
    <section aria-label={w("aiteam.v4.scene")} data-standup-scene="" className="flex min-w-0 flex-col gap-3">
      <div className="relative overflow-hidden rounded-[22px] border border-line bg-surface p-3 shadow-[var(--v2-shadow)] sm:p-4" data-part="scene">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold" data-part="when">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#ff773c]" />
            {timeLabel ? (isToday ? w("aiteam.v4.chip.today", { time: timeLabel }) : `${dayLabel}, ${timeLabel}`) : dayLabel}
            {standup?.draft ? (
              <span title={w("aiteam.standup.draft.why")} className="rounded-full border border-amber-text bg-amber-bg px-2 py-0.5 text-xs font-semibold text-amber-text" data-part="draft">
                {w("aiteam.standup.draft")}
              </span>
            ) : null}
          </p>
          {steps.length > 0 ? (
          <button
            type="button"
            onClick={() => sound.toggle()}
            aria-pressed={sound.playing}
            data-part="play"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-charcoal px-4 text-sm font-semibold text-on-charcoal shadow hover:opacity-90 disabled:opacity-50 sm:px-5 sm:text-base"
          >
            <span aria-hidden="true">{sound.playing ? "❚❚" : "▶"}</span>
            {sound.playing ? w("aiteam.standup.pause") : w("aiteam.v4.hear")}
          </button>
          ) : null}
        </div>
        <div role="img" aria-label={w("aiteam.v4.scene.alt")} className="relative mx-auto mt-1 aspect-[1000/640] w-full" data-part="picture">
          <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} aria-hidden="true" className="absolute inset-0 size-full">
            <defs>
              <radialGradient id="st-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0" stopColor="#ff773c" stopOpacity="0.22" />
                <stop offset="1" stopColor="#ff773c" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx="500" cy="350" rx="420" ry="230" fill="url(#st-glow)" />
            <ellipse cx="500" cy="350" rx="350" ry="145" fill="none" stroke="#ff773c" strokeOpacity="0.5" strokeWidth="1.4" />
            <ellipse cx="500" cy="350" rx="250" ry="92" fill="none" stroke="#c2410c" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="3 5" />
            <ellipse cx="500" cy="350" rx="160" ry="56" fill="none" stroke="#c2410c" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="3 5" />
            {from ? (
              <g data-part="beam">
                <line x1={CENTRE.x * 10} y1={CENTRE.y * 6.4 + 70} x2={from.x * 10} y2={from.y * 6.4 - 40} stroke="#ff773c" strokeWidth="2" strokeOpacity="0.8" />
                {[0.35, 0.6, 0.82].map((f) => (
                  <circle key={f} cx={CENTRE.x * 10 + (from.x * 10 - CENTRE.x * 10) * f} cy={CENTRE.y * 6.4 + 70 + (from.y * 6.4 - 40 - (CENTRE.y * 6.4 + 70)) * f} r="5" fill="#ff773c" />
                ))}
              </g>
            ) : null}
          </svg>
          <span style={{ position: "absolute", left: `${CENTRE.x}%`, top: `${CENTRE.y}%`, width: "15%" }}>
            <span className="block aspect-square w-full -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full shadow-[0_14px_40px_-12px_rgba(30,30,36,.6)]">
              <AssistantOrb state="idle" />
            </span>
          </span>
          {orbs.slice(0, SLOTS.length).map((h, i) => {
            const s = SLOTS[i];
            const on = speaker === h || speaker === "everyone";
            return (
              <span key={h} data-orb={h} data-speaking={speaker === h ? "" : undefined} style={{ position: "absolute", left: `${s.x}%`, top: `${s.y}%`, width: `${s.size}%` }}>
                <span className={`relative block aspect-square w-full -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_10px_22px_-10px_rgba(30,30,36,.7)] transition-transform ${SPHERE} ${speaker === h ? "scale-110 ring-4 ring-[#ff773c]/45" : on ? "ring-2 ring-[#ff773c]/30" : ""}`}>
                  <span aria-hidden="true" className="absolute inset-x-[18%] top-[38%] h-[22%] rounded-full bg-[linear-gradient(90deg,transparent,rgba(255,236,224,.75),transparent)] blur-[1px]" />
                  <span className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold leading-none sm:text-xs ${speaker === h ? "text-brand-text" : "text-ink"}`}>{nameOf(h)}</span>
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="rounded-[22px] border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5" data-part="report">
        {step ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-sm font-semibold text-brand-text" data-part="reporting">
                {w("aiteam.v4.reporting", { name: nameOf(step.who) })}
              </p>
              <p className="m-0 text-sm text-muted tabular-nums">{w("aiteam.v4.step", { n: String(index + 1), m: String(steps.length) })}</p>
            </div>
            <p className="m-0 mt-2 min-h-[5.5rem] font-display text-xl font-semibold leading-snug sm:text-[28px]" lang={standup?.language} data-part="words" aria-live="off">
              {parts.map((p, i) =>
                i === marked ? (
                  <mark key={i} className="rounded bg-[#ffe3d3] px-0.5 text-ink">
                    {p}
                  </mark>
                ) : (
                  <React.Fragment key={i}>{p}</React.Fragment>
                ),
              )}
            </p>
          </>
        ) : (
          <p className="m-0 text-base text-muted" data-part="none">
            {isToday ? w("aiteam.standup.none") : w("aiteam.standup.none.past")}
          </p>
        )}
        {note ? (
          <p role="alert" className="m-0 mt-2 text-sm text-amber-text">
            {note === "limit" ? w("aiteam.standup.limit") : w("aiteam.standup.failed")}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {standup ? (
            <>
              <span className="text-sm text-muted">
                {w("aiteam.standup.made", { time: timeLabel ?? "" })}
              </span>
              <Link href={ask} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline" data-part="ask">
                {w("aiteam.standup.ask")}
              </Link>
            </>
          ) : null}
          {remake && isToday ? (
            standup && standup.leftToday <= 0 ? (
              <span className="text-sm text-muted">{w("aiteam.standup.limit")}</span>
            ) : (
              <button type="button" onClick={() => void again()} disabled={making} className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-brand-text hover:underline disabled:opacity-60" data-part="again">
                {making ? w("aiteam.standup.making") : standup ? w("aiteam.standup.again", { left: String(standup.leftToday) }) : w("aiteam.standup.make")}
              </button>
            )
          ) : null}
        </div>
      </div>

      {steps.length > 0 ? (
        <ol aria-label={w("aiteam.v4.steps")} className="m-0 flex list-none gap-1.5 p-0 sm:gap-3" data-part="steps">
          {steps.map((s, i) => (
            <li key={i} className="min-w-0 flex-1">
              <button type="button" onClick={() => {
                  sound.reset();
                  setPicked(i);
                }} aria-current={i === index ? "step" : undefined} aria-label={w("aiteam.v4.step.go", { name: nameOf(s.who) })} className="group block w-full rounded-md py-2.5 text-left">
                <span aria-hidden="true" className={`block h-1 rounded-full ${i < index ? "bg-[#ff773c]/60" : i === index ? "bg-[#ff773c]" : "bg-line group-hover:bg-muted/40"}`} />
                <span aria-hidden="true" className={`mt-1.5 block truncate text-xs font-semibold sm:text-sm ${i === index ? "block text-brand-text" : "hidden text-muted sm:block"}`}>
                  {nameOf(s.who)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
