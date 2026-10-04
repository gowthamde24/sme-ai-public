"use client";

import { useSyncExternalStore } from "react";

/** "2026-10-04 21:57 UTC": what the server renders, so the first paint is identical on server and browser. */
export function utcText(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

const DIVISIONS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** "3 hours ago" / "in 2 days", in the viewer's language. */
export function relativeText(iso: string, now: Date = new Date()): string {
  let seconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  if (Number.isNaN(seconds)) return "";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of DIVISIONS) {
    if (Math.abs(seconds) < size) return rtf.format(Math.round(seconds), unit);
    seconds /= size;
  }
  return "";
}

function localText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return utcText(iso);
  const local = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  const rel = relativeText(iso);
  return rel ? `${local} (${rel})` : local;
}

const noSubscription = () => () => {};

/**
 * A timestamp shown in the VIEWER's own timezone plus how long ago it was. The server cannot know the viewer's timezone, so the
 * server snapshot is UTC (identical on server and browser at first paint) and the browser snapshot is local time; the UTC time
 * stays in the tooltip.
 */
export function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noSubscription,
    () => localText(iso),
    () => utcText(iso),
  );
  return (
    <time dateTime={iso} title={utcText(iso)}>
      {text}
    </time>
  );
}
