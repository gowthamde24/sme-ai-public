"use client";

import Link from "next/link";
import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import { addScene } from "@/components/v2/site/home2/scene";

import { drawToday, type HeroGeo, type HeroLive } from "./draw-today";

/** One enquiry coming in (a real lead: its name and where it came from), or one result going out (a real count: "4 called back today"). */
export type HeroIn = { id: string; name: string; source: string; href: string };
export type HeroOut = { key: string; text: string; href: string };
export type HeroWords = { label: string; coming: string; done: string; talk: string; emptyIn: string; connect: string };

const NODE_TOP = [50, 120, 190];
const NODE_H = 44;
const SIDE = 28;
/** The width of the rows at each side: the design's 234 px, less on a narrower card, so the orb keeps its room. Used by the markup (CSS) and the drawing (the same numbers). */
const nodeW = (cssW: number) => Math.max(150, Math.min(234, (cssW - 2 * SIDE - 220) / 2));
const COL_W = `clamp(150px, calc((100% - ${2 * SIDE + 220}px) / 2), 234px)`;

/**
 * Today's hero (app v4 part 2, owner 6 Nov 2026; behind APP_V4): the landing hero's style round the assistant's orb (draw-today.ts). On a tablet or desktop: the real enquiries coming in on the left (the newest leads, each with its
 * source), what came of today's work going out on the right (real counts), the comets between them, the assistant's sentence under the orb. On a phone: the orb with its ring, the sentence, then the same two lists (no comets: they would
 * cross a 360 px screen). Tapping the orb opens the conversation with the assistant. Nothing here is made up: no leads = one row that says so with one action (connect a lead source); a count that could not be read is left out.
 */
export function TodayHero({ incoming, results, sentence, words, talkHref, connectHref }: { incoming: readonly HeroIn[]; results: readonly HeroOut[]; sentence: string; words: HeroWords; talkHref: string; connectHref: string | null }) {
  const desk = React.useRef<HTMLCanvasElement>(null);
  const ring = React.useRef<HTMLCanvasElement>(null);
  const live = React.useRef<HeroLive>({ motion: "idle", geo: () => ({ cx: 0, cy: 0, R: 0, ri: 0, sx: 0, ox: 0, yin: [], yout: [] }) });
  const nIn = incoming.length;
  const nOut = results.length;
  React.useEffect(() => {
    const deskGeo = (w: number): HeroGeo => {
      const nw = nodeW(w);
      return { cx: w / 2, cy: 122, R: 104, ri: 56, sx: SIDE + nw, ox: w - SIDE - nw, yin: NODE_TOP.slice(0, nIn).map((y) => y + NODE_H / 2), yout: NODE_TOP.slice(0, nOut).map((y) => y + NODE_H / 2) };
    };
    const ringGeo = (w: number, h: number): HeroGeo => ({ cx: w / 2, cy: h / 2, R: Math.min(w, h) / 2 - 14, ri: 56, sx: 0, ox: 0, yin: [], yout: [] });
    const offs = [desk.current && addScene(desk.current, (c, W, H, t, look) => drawToday(c, W, H, t, look, { ...live.current, geo: (w) => deskGeo(w) })), ring.current && addScene(ring.current, (c, W, H, t, look) => drawToday(c, W, H, t, look, { ...live.current, geo: ringGeo }))];
    return () => offs.forEach((o) => o?.());
  }, [nIn, nOut]);
  const orb = (
    <Link prefetch={false} href={talkHref} aria-label={words.talk} className="h2-orbwrap block size-28 overflow-hidden rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
      <AssistantOrb state="idle" />
    </Link>
  );
  const inRow = (x: HeroIn) => (
    <Link prefetch={false} key={x.id} href={x.href} className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface/90 px-3 py-2 text-sm shadow-[0_10px_24px_-18px_rgba(30,30,36,.45)] hover:border-brand-edge" data-hero-in={x.id}>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[#ff773c] shadow-[0_0_10px_rgba(255,119,60,.8)]" />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink">{x.name}</span>
        <span className="block truncate text-xs text-muted">{x.source}</span>
      </span>
    </Link>
  );
  const outRow = (x: HeroOut) => (
    <Link prefetch={false} key={x.key} href={x.href} className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface/90 px-3 py-2 text-sm font-semibold text-ink shadow-[0_10px_24px_-18px_rgba(30,30,36,.45)] hover:border-brand-edge" data-hero-out={x.key}>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[#ec486e] shadow-[0_0_10px_rgba(236,72,110,.7)]" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{x.text}</span>
    </Link>
  );
  const empty = (
    <div className="flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-2xl border border-dashed border-line bg-surface/80 px-3 py-2 text-sm" data-hero-in="none">
      <span className="text-muted">{words.emptyIn}</span>
      {connectHref ? (
        <Link prefetch={false} href={connectHref} className="font-semibold text-brand-text underline underline-offset-4">
          {words.connect}
        </Link>
      ) : null}
    </div>
  );
  return (
    <section aria-label={words.label} data-part="today-hero" className="relative overflow-hidden rounded-[22px] border border-line bg-[radial-gradient(ellipse_46%_80%_at_50%_42%,var(--v2-brand-bg),var(--v2-surface)_60%)]">
      {/* tablet and desktop: the design's 300 px stage */}
      <div className="relative hidden h-[300px] md:block">
        <canvas ref={desk} aria-hidden="true" className="absolute inset-0 block size-full" />
        <p className="absolute left-4 top-3 m-0 text-xs font-extrabold text-brand-text">{words.coming}</p>
        <p className="absolute right-4 top-3 m-0 text-xs font-extrabold text-muted">{words.done}</p>
        <div style={{ position: "absolute", left: SIDE, top: NODE_TOP[0], width: COL_W }}>
          <div className="flex flex-col gap-[26px]">{nIn ? incoming.slice(0, 3).map(inRow) : empty}</div>
        </div>
        <div className="absolute left-1/2 top-[66px] -translate-x-1/2">{orb}</div>
        <div style={{ position: "absolute", right: SIDE, top: NODE_TOP[0], width: COL_W }}>
          <div className="flex flex-col gap-[26px]">{results.slice(0, 3).map(outRow)}</div>
        </div>
        <p aria-live="polite" className="absolute inset-x-[22%] bottom-[14px] m-0 text-center font-display text-lg font-bold leading-snug tracking-[-0.01em] lg:text-xl">
          {sentence}
        </p>
      </div>
      {/* phone: the orb with its ring, the sentence, then what is coming in and what is done */}
      <div className="flex flex-col gap-4 p-4 md:hidden">
        <div className="relative mx-auto aspect-square w-full max-w-[240px]">
          <canvas ref={ring} aria-hidden="true" className="absolute inset-0 block size-full" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">{orb}</div>
        </div>
        <p aria-live="polite" className="m-0 text-center font-display text-lg font-bold leading-snug">
          {sentence}
        </p>
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs font-extrabold text-brand-text">{words.coming}</p>
          {nIn ? incoming.slice(0, 3).map(inRow) : empty}
        </div>
        {nOut ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs font-extrabold text-muted">{words.done}</p>
            {results.slice(0, 3).map(outRow)}
          </div>
        ) : null}
      </div>
    </section>
  );
}
