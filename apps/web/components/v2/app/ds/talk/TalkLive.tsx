"use client";

import type * as React from "react";

import { Orb, type OrbState } from "@/components/v2/Orb";

import { btnMain, btnQuiet } from "../../ui";
import { makeT, type Words } from "../../words";
import { pieces, type TalkLine, type TalkState } from "./script";
import { clock, type TalkLive as Live } from "./use-talk-live";

const ORB: Record<TalkState, OrbState> = { listening: "listen", thinking: "think", speaking: "speak" };

/** A line with its numbers, ₹ amounts and times in orange. */
function Line({ text }: { text: string }) {
  return (
    <>
      {pieces(text).map((p, i) =>
        p.key ? (
          <mark key={i} className="bg-transparent font-semibold text-brand-text">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * "Talk live" in place (design system v6): what the command bar shows while it is a live conversation. The real circle (components/v2/Orb) follows the state; a red timer under it; the label "LIVE WITH YOUR ASSISTANT · SPEAKING/LISTENING"; the transcript streams here (the owner's lines small and grey,
 * the assistant's larger, the key numbers in orange); a plan card appears inside with "Yes, start" and "Change". `controls` is the second row: moving sound bars with "Just talk. Interrupt any time.", the language, Mute, Type, End. Voice is mocked on staging (`mock`).
 */
export function TalkLiveBody({ live, words, language, onType, mock = true, afterLine = null }: { live: Live; words?: Words; language: string; onType: () => void; mock?: boolean; /** Something under a line of the transcript (My assistant: "Teach this" under the assistant's answers); null = nothing */ afterLine?: ((line: TalkLine, index: number) => React.ReactNode) | null }) {
  const t = makeT(words);
  const stateWord = t(live.state === "speaking" ? "dst.speaking" : live.state === "thinking" ? "dst.thinking" : "dst.listening");
  return (
    <div data-part="talk-live" data-talk-state={live.state} className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <Orb px={72} state={ORB[live.state]} halo />
          <span data-part="talk-timer" className="font-mono text-sm font-semibold tabular-nums text-red-text">
            {clock(live.seconds)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p data-part="talk-label" className="text-xs font-bold tracking-wider text-red-text">
            <span aria-hidden="true">● </span>
            {t("dst.live_with")} · {stateWord}
          </p>
          <div aria-live="polite" className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
            {live.lines.map((l, i) => (
              <div key={i}>
                <p data-who={l.who} className={l.who === "owner" ? "text-sm text-muted" : "text-xl font-medium leading-snug"}>
                  <Line text={l.text} />
                </p>
                {afterLine ? afterLine(l, i) : null}
              </div>
            ))}
          </div>
          {live.plan ? (
            <div data-part="talk-plan" className="mt-3 rounded-xl border border-brand-edge bg-brand-bg p-3">
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {(
                  [
                    ["dst.plan.what", live.plan.what],
                    ["dst.plan.time", live.plan.time],
                    ["dst.plan.cost", live.plan.cost],
                    ["dst.plan.hours", live.plan.hours],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="shrink-0 text-muted">{t(k)}</dt>
                    <dd className="font-semibold">
                      <Line text={v} />
                    </dd>
                  </div>
                ))}
              </dl>
              {live.answer === null ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => live.decide("yes")} className={btnMain}>
                    {t("dst.yes_start")}
                  </button>
                  <button type="button" onClick={() => live.decide("change")} className={btnQuiet}>
                    {t("dst.change")}
                  </button>
                </div>
              ) : (
                <p role="status" data-part="talk-answer" className="mt-3 text-sm font-semibold text-brand-text">
                  {t(live.answer === "yes" ? "dst.answer_yes" : "dst.answer_change")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div data-part="talk-controls" className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <span className="ds-bars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="min-w-0 flex-1 text-sm text-muted">{t("dst.just_talk")}</span>
        <span className="rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm font-semibold" data-part="talk-language">
          {language} ▾
        </span>
        <button type="button" aria-pressed={live.muted} onClick={live.toggleMute} className={btnQuiet}>
          {t(live.muted ? "dst.unmute" : "dst.mute")}
        </button>
        <button type="button" onClick={onType} className={btnQuiet}>
          {t("dst.type")}
        </button>
        <button type="button" onClick={live.end} className="inline-flex min-h-11 items-center rounded-lg bg-red-text px-4 text-sm font-semibold text-bg">
          {t("dst.end")}
        </button>
      </div>
      {mock ? <p className="text-xs text-muted">{t("dst.mock")}</p> : null}
    </div>
  );
}
