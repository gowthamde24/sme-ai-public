"use client";

import { word, type Labels } from "../labels";
import { useOnline } from "./use-online";
import { useQueued } from "./offline-queue";

/** "Waiting for network" (app v4 part 9): a small chip in the top bar while the browser has no connection, or while safe taps still wait to be done (their number is on it). Nothing is drawn when all is well. */
export function WaitingChip({ labels }: { labels?: Labels }) {
  const online = useOnline();
  const n = useQueued();
  if (online && n === 0) return null;
  return (
    <span role="status" data-part="waiting-chip" className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-amber-text bg-amber-bg px-3 text-xs font-semibold text-amber-text">
      <span aria-hidden="true" className="size-2 rounded-full bg-amber-text" />
      {word(labels, "frame.offline.waiting", "Waiting for network")}
      {n > 0 ? <span className="tabular-nums">· {n}</span> : null}
    </span>
  );
}
