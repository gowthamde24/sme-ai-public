"use client";

import * as React from "react";

import { SCRIPTS, type TalkKind, type TalkLine, type TalkPlan, type TalkState } from "./script";

export type PlanAnswer = "yes" | "change" | null;
export type TalkLive = {
  /** The bar is a live conversation (true from start() to end()). */
  active: boolean;
  state: TalkState;
  /** Seconds since it started. */
  seconds: number;
  lines: readonly TalkLine[];
  plan: TalkPlan | null;
  /** What the owner answered to the plan card, or null while it waits. */
  answer: PlanAnswer;
  muted: boolean;
  start: () => void;
  end: () => void;
  toggleMute: () => void;
  decide: (answer: "yes" | "change") => void;
};

/**
 * "Talk live" IN PLACE (design system v6): the same bar turns into a live conversation, no popup. This is the MOCK engine (voice is mocked on staging): it plays a script of made-up steps (lib: ./script.ts) on timers and exposes the same things the real voice will: the assistant's state, the transcript
 * line by line, a plan card that waits for "Yes, start" or "Change", a running second count, mute and end. Timers are cleared on end and on unmount; muting stops the owner's lines from appearing (the assistant keeps going).
 */
export function useTalkLive(kind: TalkKind, { speed = 1 }: { speed?: number } = {}): TalkLive {
  const [active, setActive] = React.useState(false);
  const [state, setState] = React.useState<TalkState>("listening");
  const [seconds, setSeconds] = React.useState(0);
  const [lines, setLines] = React.useState<readonly TalkLine[]>([]);
  const [plan, setPlan] = React.useState<TalkPlan | null>(null);
  const [answer, setAnswer] = React.useState<PlanAnswer>(null);
  const [muted, setMuted] = React.useState(false);
  const mutedRef = React.useRef(false);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const ticker = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);
  React.useEffect(() => clear, [clear]);

  const end = React.useCallback(() => {
    clear();
    setActive(false);
    setSeconds(0);
    setLines([]);
    setPlan(null);
    setAnswer(null);
    setMuted(false);
    mutedRef.current = false;
    setState("listening");
  }, [clear]);

  const start = React.useCallback(() => {
    clear();
    setActive(true);
    setSeconds(0);
    setLines([]);
    setPlan(null);
    setAnswer(null);
    setState("listening");
    ticker.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    for (const step of SCRIPTS[kind]) {
      timers.current.push(
        setTimeout(() => {
          if (step.kind === "state") setState(step.state);
          else if (step.kind === "line") {
            if (step.line.who === "owner" && mutedRef.current) return;
            setLines((l) => [...l, step.line]);
          } else setPlan(step.plan);
        }, step.at / speed),
      );
    }
  }, [clear, kind, speed]);

  const toggleMute = React.useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  }, []);
  const decide = React.useCallback((a: "yes" | "change") => setAnswer(a), []);

  return { active, state, seconds, lines, plan, answer, muted, start, end, toggleMute, decide };
}

/** 83 seconds -> "1:23". */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
