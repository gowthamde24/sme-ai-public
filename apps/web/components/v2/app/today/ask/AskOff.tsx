"use client";

import { Mic, SendHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { AskTurnOnContext } from "./ask-turn-on";
import type { AskWords } from "./ask-words";


/**
 * The question line of an assistant that is switched OFF for the workspace (first run: the workspace's own switch starts off). The line, the microphone and Send are drawn where they will be, so the person sees where they type, but they cannot be pressed,
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
      <div className="flex items-center gap-2" aria-hidden="true">
        <div className={`flex min-w-0 flex-1 items-center rounded-full border border-edge bg-bg px-5 text-base text-muted opacity-70 ${big ? "min-h-12 md:min-h-14" : "min-h-11"}`}>{w(big ? "ask.placeholder.hero" : "ask.panel.placeholder")}</div>
        <span className={`inline-flex shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-muted opacity-70 ${big ? "size-12 md:size-14" : "size-11"}`}>
          <Mic className="size-5" />
        </span>
        <span className={`inline-flex shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-muted opacity-70 ${big ? "size-12 md:size-14" : "size-11"}`}>
          <SendHorizontal className="size-5" />
        </span>
      </div>
      <p className="text-base text-muted">{w("ask.off.line")}</p>
      {turnOn ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-ask="turn-on" disabled={pending} onClick={run} className="inline-flex min-h-11 items-center justify-center rounded-full border border-brand-edge bg-brand px-5 text-[15px] font-bold whitespace-nowrap text-on-brand hover:brightness-95 disabled:opacity-60">
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
