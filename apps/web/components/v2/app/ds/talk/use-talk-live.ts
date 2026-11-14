"use client";

import * as React from "react";

import { AskVoiceContext } from "../../today/ask/ask-store";
import type { AskHow, AskOutcome } from "@/lib/api/ask-consent";
import type { ActionStatus } from "@/lib/api/turns";
import type { EndWord } from "@/lib/browser-voice/protocol";
import { SCRIPTS, type TalkKind, type TalkLine, type TalkPlan, type TalkState } from "./script";
import { useRealTalk, type RealTalkOptions } from "./use-real-talk";

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
  /** `second`: this "yes" is the answer to the second question of a big plan ("Really call 255 people?"). */
  decide: (answer: "yes" | "change", second?: boolean) => void;
  /** The API answered a plain yes with `second_yes_required`: the plan waits and asks its second question. */
  secondAsked?: boolean;
  /** "Ask first" for the people the plan left out (owner, 14 Nov): a WhatsApp "reply OK" or "I confirm they agreed" (a NEW plan card then replaces this one). Absent in the made-up conversation: no buttons. */
  askConsent?: (how: AskHow) => Promise<AskOutcome>;
  /** REAL voice only (everything below is absent in the made-up conversation): */
  real?: boolean;
  /** The socket is opening: the microphone is on, the API has not said "ready". */
  connecting?: boolean;
  /** Why it stopped without the person asking, or null: a closed word the bar says in plain words, never silence. */
  problem?: TalkProblem | null;
  /** Start again after a problem. */
  retry?: () => void;
  /** The conversation ended by itself in a normal way (the person said bye, or closed it): the bar goes back to normal. */
  finished?: boolean;
  /** Follows the microphone while it listens and the voice while it speaks (the orb and the sound bars move with the loudness); null otherwise. */
  analyser?: AnalyserNode | null;
  /** A failed TURN that does not end the conversation (the API's non-fatal `error`, e.g. `ai_paused_until`): its code; the bar says it in words and Mute / Type / End keep working. Cleared by the next turn. */
  turnProblem?: string | null;
  /** What the assistant is doing while it thinks (the API's step code: working, looking); the bar says it in the app's language. */
  step?: "working" | "looking" | null;
  /** A gentle line: still there? / the time limit is near. */
  notice?: { kind: "checkin" | "ending"; seconds: number } | null;
  /** The real plan's state (by tap or by a spoken "yes"), and the tap in progress / its refusal as a dictionary key. */
  planStatus?: ActionStatus | null;
  planBusy?: boolean;
  planError?: string | null;
  /** A tap on the bar while the assistant talks: it stops and listens. */
  bargeIn?: () => void;
};
/** A real conversation that did not start or did not go on: `connect` (never reached "ready"), `lost` (it was going and the line dropped), `mic` (blocked), `end` (the API ended it: `word`). `retry`: "Try again" makes sense. */
export type TalkProblem = { kind: "connect" | "lost" | "mic" | "end"; word: EndWord | null; retry: boolean };

/**
 * "Talk live" IN PLACE (design system v6): the same bar turns into a live conversation, no popup. This is the MOCK engine (voice is mocked on staging): it plays a script of made-up steps (lib: ./script.ts) on timers and exposes the same things the real voice will: the assistant's state, the transcript
 * line by line, a plan card that waits for "Yes, start" or "Change", a running second count, mute and end. Timers are cleared on end and on unmount; muting stops the owner's lines from appearing (the assistant keeps going).
 */
export function useTalkLive(kind: TalkKind, { speed = 1, ...real }: { speed?: number } & Omit<Partial<RealTalkOptions>, "voice"> = {}): TalkLive {
  const voice = React.useContext(AskVoiceContext);
  const mock = useMockTalk(kind, speed);
  const live = useRealTalk(voice, real);
  // REAL when BROWSER_VOICE gave the page a voice (AskVoiceContext); the made-up conversation stays only where there is none (flag off, a test)
  return voice ? live : mock;
}

function useMockTalk(kind: TalkKind, speed: number): TalkLive {
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
  const decide = React.useCallback((a: "yes" | "change", _second?: boolean) => setAnswer(a), []);

  return { active, state, seconds, lines, plan, answer, muted, start, end, toggleMute, decide };
}

/** 83 seconds -> "1:23". */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
