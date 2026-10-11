"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";

import { FRAME_LOADING } from "../contract";
import { useFrameData } from "../frame-store";
import { fillClass, indiaTime, untilFor } from "../frame-parts";
import { say, type TodayWords } from "./today-words";
import type { TodayData } from "./types";

/**
 * The usage card in the header of Today (job AV), from the weekly figure (`GET /ai-usage/week`, Owner and Admin only: nobody else is shown it): how much of THIS WEEK's allowance is left, as a percentage and
 * a bar, never a count of tokens or money. The lighter mode or the pause is said in words when the state of the menu's card (`getAiUsage()`) says so. If the figure cannot be read the card says "Not available
 * yet" instead of showing another window's number. On a phone it is a small pill that opens Settings, where the full card is.
 */
export function TodayUsage({ words, settingsHref, week }: { words: TodayWords; settingsHref: string; week: TodayData["week"] }) {
  const frame = useFrameData(FRAME_LOADING);
  if (!frame.showUsage) return null;
  const usage = frame.usage;
  const title = say(words, "today.usage.title");
  if (week === null || week === "error") {
    return (
      <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        {title}: {say(words, "frame.notyet")}
      </p>
    );
  }
  const left = usage?.state === "paused" ? 0 : 100 - week.percent;
  const leftText = say(words, "today.usage.left", { percent: left });
  const aria = say(words, "today.usage.aria", { percent: left });
  const until = usage ? untilFor(usage) : null;
  const note =
    usage?.state === "light"
      ? say(words, "frame.ailight", { time: indiaTime(until ?? usage.resets_at_today) })
      : usage?.state === "paused"
        ? until
          ? say(words, "frame.aipaused", { time: indiaTime(until) })
          : say(words, "frame.aipausednow")
        : null;
  const fill = !usage || usage.state === "ok" ? "bg-brand" : "bg-amber-text";
  return (
    <>
      <div className="flex min-w-60 flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3 max-md:hidden">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-4 text-brand-text" aria-hidden="true" />
            {title}
          </span>
          <span className="text-muted">{leftText}</span>
        </div>
        <div role="meter" aria-label={aria} aria-valuemin={0} aria-valuemax={100} aria-valuenow={left} className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${fill} ${fillClass(left)}`} />
        </div>
        {note ? <p className="text-sm font-medium text-amber-text">{note}</p> : null}
      </div>
      <Link href={settingsHref} aria-label={aria} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-ink md:hidden">
        <span aria-hidden="true" className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-surface-2">
          <span className={`block h-full ${fill} ${fillClass(left)}`} />
        </span>
        <span aria-hidden="true">{left}%</span>
      </Link>
    </>
  );
}
