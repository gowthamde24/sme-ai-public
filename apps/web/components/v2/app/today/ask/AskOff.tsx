"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { AskTurnOnContext } from "./ask-turn-on";
import type { AskWords } from "./ask-words";


/**
 * The question line of an assistant that is switched OFF for the workspace (first run: the workspace's own switch starts off). (No dead-looking input any more, owner 29 Nov: one sentence and one button.) The line, the microphone and Send were drawn where they will be, so the person sees where they type, but they cannot be pressed,
 * and under them: why, and for the Owner or an Admin ONE button that turns it on (then the page is read again and the live line takes its place). Anyone else is told whom to ask. `look` is the card (Today) or the panel (the floating orb).
 */
export function AskOff({ words, look }: { words: AskWords; look: "card" | "panel" }) {
  const turnOn = React.useContext(AskTurnOnContext);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [problem, setProblem] = React.useState<"failed" | "still" | null>(null);
  const w = (key: string) => words[key] ?? key;
  const run = () =>
    start(async () => {
      setProblem(null);
      try {
        const result = turnOn ? await turnOn() : { ok: false as const };
        if (!result.ok) setProblem("failed");
        else if (!result.live) setProblem("still");
        else router.refresh();
      } catch {
        setProblem("failed");
      }
    });
  const big = look === "card";
  return (
    <div data-ask="off" data-ask-where={look} className="flex min-w-0 flex-col gap-3">
      <p className="text-base text-muted">{w("ask.off.line")}</p>
      {turnOn ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-ask="turn-on" disabled={pending} onClick={run} className="inline-flex min-h-11 items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold whitespace-nowrap text-on-brand hover:brightness-95 disabled:opacity-60">
            {pending ? w("ask.off.working") : w("ask.off.turnon")}
          </button>
        </div>
      ) : (
        <p data-ask="off-owner" className="text-sm font-medium">
          {w("ask.off.owner")}
        </p>
      )}
      {problem ? (
        <p role="alert" className="rounded-lg border border-amber-text bg-amber-bg px-3 py-2 text-sm font-medium text-amber-text">
          {w(problem === "still" ? "ask.off.still" : "ask.off.failed")}
        </p>
      ) : null}
    </div>
  );
}
