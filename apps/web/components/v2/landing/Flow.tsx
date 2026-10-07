"use client";

import { Check, FileText, Inbox, ListChecks, MessageSquareText, PackageCheck, Pause, Play, Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { FlowLabels } from "@/components/v2/landing/flow-labels";
import { useMedia } from "@/components/v2/landing/hooks";
import {
  NODE_COUNT,
  PHASE_MS,
  SLIDE_MS,
  TOUCH_PAUSE_MS,
  cardVisible,
  lineStep,
  motionAllowed,
  nextPhase,
  nodeAt,
  nodeDone,
  shouldPlay,
  slideAt,
} from "@/components/v2/landing/motion";

const NODES = [Inbox, Search, ListChecks, FileText, MessageSquareText, PackageCheck] as const;

/** Whole-class lookups instead of inline styles: Tailwind sees every literal, and the source rules stay satisfied. */
const LINE_CLASS = ["scale-x-0", "scale-x-20", "scale-x-40", "scale-x-60", "scale-x-80", "scale-x-100"] as const;
const CHIP_CLASS = ["translate-x-[0%]", "translate-x-[100%]", "translate-x-[200%]", "translate-x-[300%]", "translate-x-[400%]", "translate-x-[500%]"] as const;
const FADE = "transition-[opacity,transform,translate,scale] duration-500 ease-out";

/* ------------------------------------------------------------------ pieces */
/** The mini-card for a node: what happens there. Draft states always say "a person approves". */
function MiniCard({ i, l, visible }: { i: number; l: FlowLabels; visible: boolean }) {
  const c = l.cards;
  const draft = <span className="mt-2 inline-block rounded-md border border-edge bg-surface px-2 py-0.5 text-sm font-medium">{l.draft}</span>;
  let body: ReactNode;
  switch (i) {
    case 0:
      body = (<><p className="font-semibold">{c.leadT}</p><p className="mt-1 text-sm text-muted">{c.leadS}</p></>);
      break;
    case 1:
      body = (<><p className="font-semibold">{c.researchT}</p><p className="mt-1 text-sm text-muted">{c.researchS}</p></>);
      break;
    case 2:
      body = (
        <ul className="flex flex-col items-start gap-1.5">
          {[c.req1, c.req2].map((text) => (
            <li key={text} className="rounded-md bg-brand-bg px-2 py-0.5 text-sm font-medium text-brand-text">{text}</li>
          ))}
        </ul>
      );
      break;
    case 3:
      body = (<><p className="font-semibold">{c.quoteT}</p>{draft}</>);
      break;
    case 4:
      body = (<><p className="font-semibold">{c.followupT}</p><p className="mt-1 text-sm text-muted">{c.followupS}</p>{draft}</>);
      break;
    default:
      body = (
        <p className="flex items-start gap-2 font-semibold">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {c.money}
        </p>
      );
  }
  const money = i === 5;
  return (
    <div
      data-card={i}
      className={[
        "min-h-[7.25rem] w-full rounded-lg border p-3 text-left text-base sm:min-h-[8.5rem]",
        FADE,
        money ? "border-amber-text bg-amber-bg text-amber-text" : "border-line bg-surface shadow-[var(--v2-shadow)]",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      ].join(" ")}
    >
      {body}
    </div>
  );
}

/** A node: a plain circle plus two overlays (lit, done) that only change opacity and scale. */
function Node({ i, lit, done, l }: { i: number; lit: boolean; done: boolean; l: FlowLabels }) {
  const Icon = NODES[i];
  return (
    <div className="relative z-10 grid size-14 place-items-center rounded-full border-2 border-edge bg-surface">
      <span
        aria-hidden="true"
        className={`absolute inset-[-2px] rounded-full border-2 border-brand-edge bg-brand ${FADE} ${lit ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
      />
      <Icon className="relative size-6 text-ink" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={`absolute -right-1 -top-1 grid size-6 place-items-center rounded-full border border-surface bg-green-bg text-green-text ${FADE} ${done ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
      >
        <Check className="size-4" />
      </span>
      <span className="sr-only">{l.steps[i]}</span>
    </div>
  );
}

/** The small card that travels. It carries the made-up enquiry from node to node. */
function Chip({ l }: { l: FlowLabels }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-edge bg-surface px-2.5 py-1 text-sm font-semibold shadow-[var(--v2-shadow)]">
      <Inbox className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
      <span>{l.chip}</span>
    </span>
  );
}

/* ------------------------------------------------------------------- hook */
function usePlayback(reduced: boolean) {
  const [forceMotion, setForceMotion] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [touchPaused, setTouchPaused] = useState(false);
  const [inView, setInView] = useState(true); // starts on load; a layout that is not displayed reports "not in view" and stays still
  const [tabVisible, setTabVisible] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const touchTimer = useRef<number>(0);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  useEffect(() => () => window.clearTimeout(touchTimer.current), []);

  /** The visitor touched, swiped or typed on the row: stay still for a while. */
  const touch = useCallback(() => {
    setTouchPaused(true);
    window.clearTimeout(touchTimer.current);
    touchTimer.current = window.setTimeout(() => setTouchPaused(false), TOUCH_PAUSE_MS);
  }, []);

  const inputs = { reduced, forceMotion, inView, tabVisible, userPaused, touchPaused };
  // the ref is returned apart from the state: an object that holds a ref cannot be read while rendering
  return { box, pb: { playing: shouldPlay(inputs), allowed: motionAllowed(inputs), userPaused, setUserPaused, forceMotion, setForceMotion, touchPaused, touch } };
}

/** The pause icon (normal case) or the quiet "Play motion" text (reduced motion only). */
type Playback = ReturnType<typeof usePlayback>["pb"];
function Controls({ l, reduced, pb }: { l: FlowLabels; reduced: boolean; pb: Playback }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <span className="rounded-md bg-info-bg px-2 py-1 text-sm font-medium text-info-text">{l.example}</span>
      {reduced ? (
        <button
          type="button"
          data-motion-toggle
          onClick={() => pb.setForceMotion((v) => !v)}
          className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-ink"
        >
          {pb.forceMotion ? l.motionStop : l.motionPlay}
        </button>
      ) : (
        <button
          type="button"
          data-anim-toggle
          onClick={() => pb.setUserPaused((v) => !v)}
          aria-label={pb.userPaused ? l.play : l.pause}
          className="inline-grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
        >
          {pb.userPaused ? <Play className="size-5" aria-hidden="true" /> : <Pause className="size-5" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- laptop strip */
function Strip({ l, reduced }: { l: FlowLabels; reduced: boolean }) {
  const { box, pb } = usePlayback(reduced);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!pb.playing) return;
    const id = window.setTimeout(() => setPhase(nextPhase), PHASE_MS[phase]);
    return () => window.clearTimeout(id);
  }, [pb.playing, phase]);

  // static (reduced motion, not overridden): every node and every mini-card shown, nothing moving
  const still = !pb.allowed;
  const shown = still ? 6 : phase;
  const active = nodeAt(shown);
  return (
    <div ref={box} role="group" aria-label={l.group} data-flow data-mode="strip" data-active={still ? "static" : active} data-phase={shown}
      data-playing={pb.playing ? "true" : "false"} data-reduced={reduced ? "true" : "false"}>
      <div className="relative">
        {/* the line behind the nodes, and how far the enquiry has got */}
        <div aria-hidden="true" className="absolute left-[8.333%] right-[8.333%] top-[calc(2.75rem+1.75rem)] h-[3px] -translate-y-1/2 rounded-full bg-line" />
        <div aria-hidden="true" className="absolute left-[8.333%] right-[8.333%] top-[calc(2.75rem+1.75rem)] h-[3px] -translate-y-1/2">
          <div className={`h-full origin-left rounded-full bg-brand transition-[transform,scale] duration-700 ease-in-out ${still ? LINE_CLASS[5] : LINE_CLASS[lineStep(shown)]}`} />
        </div>
        {/* the travelling enquiry: one column wide, moved by whole columns */}
        {!still && (
          <div aria-hidden="true" className={`pointer-events-none absolute left-0 top-0 z-20 flex w-1/6 justify-center px-1 transition-[opacity,transform,translate,scale] duration-1000 ease-in-out ${CHIP_CLASS[active]} ${shown >= 7 ? "opacity-0" : "opacity-100"}`}>
            <Chip l={l} />
          </div>
        )}
        <ol className="grid grid-cols-6 gap-3 pt-11">
          {l.steps.map((title, i) => (
            <li key={title} className="flex flex-col items-center text-center" aria-current={!still && active === i ? "step" : undefined}>
              <Node i={i} lit={!still && active === i && shown < 7} done={still || nodeDone(i, shown)} l={l} />
              <p className="mt-2 break-words font-display text-lg font-semibold leading-tight">{title}</p>
              <div className="mt-3 w-full">
                <MiniCard i={i} l={l} visible={still || cardVisible(i, shown)} />
              </div>
            </li>
          ))}
        </ol>
      </div>
      <Controls l={l} reduced={reduced} pb={pb} />
    </div>
  );
}

/* ------------------------------------------------- tablet and phone: swipe */
function Swipe({ l, reduced }: { l: FlowLabels; reduced: boolean }) {
  const { box, pb } = usePlayback(reduced);
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const programmatic = useRef(false);
  const settle = useRef<number>(0);

  const stride = () => {
    const kids = scroller.current?.children;
    return kids && kids.length > 1 ? (kids[1] as HTMLElement).offsetLeft - (kids[0] as HTMLElement).offsetLeft : 0;
  };
  const goTo = useCallback(
    (i: number) => {
      const el = scroller.current;
      if (!el) return;
      programmatic.current = true;
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => (programmatic.current = false), 900);
      setActive(i);
      el.scrollTo({ left: i * stride(), behavior: reduced ? "auto" : "smooth" });
    },
    [reduced],
  );

  // advance by itself, every few seconds, until the visitor touches it
  useEffect(() => {
    if (!pb.playing) return;
    const id = window.setTimeout(() => goTo((active + 1) % NODE_COUNT), SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [pb.playing, active, goTo]);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  return (
    <div ref={box} role="group" aria-label={l.group} data-flow data-mode="swipe" data-active={active}
      data-playing={pb.playing ? "true" : "false"} data-reduced={reduced ? "true" : "false"} data-touch-paused={pb.touchPaused ? "true" : "false"}>
      <div
        ref={scroller}
        tabIndex={0}
        aria-roledescription="carousel"
        aria-label={l.group}
        onPointerDown={pb.touch}
        onTouchStart={pb.touch}
        onWheel={pb.touch}
        onKeyDown={pb.touch}
        onScroll={(e) => {
          if (programmatic.current) return; // our own scroll: the index is already set
          const i = slideAt(e.currentTarget.scrollLeft, stride());
          if (i !== active) setActive(i);
        }}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {l.steps.map((title, i) => (
          <div key={title} className="relative w-[80%] shrink-0 snap-center pt-11 sm:w-[46%]" aria-current={active === i ? "step" : undefined}>
            <div aria-hidden="true" className="absolute left-[-0.75rem] right-[-0.75rem] top-[calc(2.75rem+1.75rem)] h-[3px] -translate-y-1/2 bg-line" />
            <div aria-hidden="true" className={`pointer-events-none absolute left-0 top-0 z-20 flex w-full justify-center transition-[opacity,transform,translate,scale] duration-700 ease-out ${active === i ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
              <Chip l={l} />
            </div>
            <div className="flex flex-col items-center text-center">
              <Node i={i} lit={active === i} done={i < active} l={l} />
              <p className="mt-2 font-display text-lg font-semibold leading-tight">{title}</p>
              <div className="mt-3 w-full">
                <MiniCard i={i} l={l} visible />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div role="group" aria-label={l.dotsGroup} className="mt-1 flex justify-center">
        {l.dots.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              pb.touch();
              goTo(i);
            }}
            aria-label={label}
            aria-current={active === i ? "step" : undefined}
            className="relative grid size-11 place-items-center"
          >
            <span className="size-2.5 rounded-full border border-edge bg-surface" />
            <span aria-hidden="true" className={`absolute size-2.5 rounded-full bg-brand-edge transition-[opacity,transform,translate,scale] duration-300 ${active === i ? "scale-125 opacity-100" : "scale-50 opacity-0"}`} />
          </button>
        ))}
      </div>
      <Controls l={l} reduced={reduced} pb={pb} />
    </div>
  );
}

/**
 * The hero: the whole pipeline in one horizontal row. The server renders BOTH layouts and CSS picks one (the laptop strip
 * from 1024px, the swipe row below), so the markup never depends on the screen and nothing jumps after hydration. The one
 * that is not displayed reports "not in view" to its IntersectionObserver and stays still.
 */
export function Flow({ labels }: { labels: FlowLabels }) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  return (
    <>
      <div className="hidden lg:block">
        <Strip l={labels} reduced={reduced} />
      </div>
      <div className="lg:hidden">
        <Swipe l={labels} reduced={reduced} />
      </div>
    </>
  );
}
