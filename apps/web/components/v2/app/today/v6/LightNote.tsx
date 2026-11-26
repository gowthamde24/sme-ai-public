"use client";

import { NO_FRAME_DATA } from "../../contract";
import { useFrameData } from "../../frame-store";
import { indiaTime, untilFor } from "../../frame-parts";
import { makeT, type Words } from "../../words";

/** When the assistant is in its lighter mode, until when (an ISO time), else null. Same rule as the banner at the top: only for the people the API gives the usage to (Owner, Admin). */
export function useLightUntil(): string | null {
  const frame = useFrameData(NO_FRAME_DATA);
  const usage = frame.usage;
  if (!frame.showUsage || !usage || usage.state !== "light") return null;
  return untilFor(usage) ?? usage.resets_at_today;
}

/**
 * "Light mode until {time}" next to the composer (owner, 15 Nov: the line shows wherever the assistant is asked something, not only in the banner at the top).
 * The same sentence as the banner and the usage card (`frame.ailight`), so the three always agree. Decided by C2, owner can reverse.
 */
export function LightNote({ words, until, className = "" }: { words: Words; until: string | null; className?: string }) {
  if (!until) return null;
  const t = makeT(words);
  return (
    <p data-part="light-note" role="status" className={`inline-block rounded-md border border-amber-text bg-amber-bg px-2.5 py-1 text-sm font-medium text-amber-text ${className}`}>
      {t("frame.ailight", { time: indiaTime(until) })}
    </p>
  );
}
