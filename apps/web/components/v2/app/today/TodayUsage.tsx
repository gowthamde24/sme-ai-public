"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";

import { FRAME_LOADING } from "../contract";
import { useFrameData } from "../frame-store";
import { fillClass, indiaTime, untilFor } from "../frame-parts";
import { say, type TodayWords } from "./today-words";

/**
 * The usage card in the header of Today (job AU), from the same read as the menu's card (`getAiUsage()`, Owner and Admin only: nobody else is shown it). A percentage and a bar, never a count of
 * tokens or money. The API gives the allowance of today and of the month, not of a week: the card shows what is left of the MONTH, and the lighter mode or the pause in words when the state says so.
 * On a phone it is a small pill that opens Settings, where the full card is.
 */
export function TodayUsage({ words, settingsHref }: { words: TodayWords; settingsHref: string }) {
  const frame = useFrameData(FRAME_LOADING);
  if (!frame.showUsage) return null;
  const usage = frame.usage;
  const title = say(words, "today.usage.title");
  if (!usage) {
    return frame.ready ? (
      <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        {title}: {say(words, "frame.notyet")}
      </p>
    ) : (
      <div aria-hidden="true" className="h-[68px] w-60 animate-pulse rounded-2xl border border-line bg-surface max-md:h-11 max-md:w-28 max-md:rounded-full" />
    );
  }
  const left = usage.state === "paused" ? 0 : 100 - usage.month_percent;
  const leftText = say(words, "today.usage.left", { percent: left });
  const aria = say(words, "today.usage.aria", { percent: left });
  const until = untilFor(usage);
  const note =
    usage.state === "light"
      ? say(words, "frame.ailight", { time: indiaTime(until ?? usage.resets_at_today) })
      : usage.state === "paused"
        ? until
          ? say(words, "frame.aipaused", { time: indiaTime(until) })
          : say(words, "frame.aipausednow")
        : null;
  const fill = usage.state === "ok" ? "bg-brand" : "bg-amber-text";
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
