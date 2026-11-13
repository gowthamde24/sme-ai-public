"use client";

import * as React from "react";

import { makeT, type Words } from "../../words";
import type { DayView } from "./day-data";
import { useLiveCall } from "./use-live-call";

/** Places a child by plain style only (the leak audit: no element has both style and className); the box inside carries the classes. */
function At({ s, children }: { s: React.CSSProperties; children: React.ReactNode }) {
  return <span style={{ position: "absolute", ...s }}>{children}</span>;
}

/**
 * "Your day" (design system v6, the final Today): the timeline of the working day, 9 am to 9 pm, as a full-width card. The hour grid; the calls of today as glowing dots in three lanes (the newest pulses while a call is live); visits as green pins with the name and the time; the "Now" line; the call-backs the assistant
 * planned as dashed circles; a legend; and one line with the calls handled, the things sent to the person and the next action. On a phone the track scrolls sideways. A part that could not be read is not drawn. It is a lazy chunk: Today's first paint does not carry it.
 */
export default function YourDay({ view, words, tenantId, mockLive }: { view: DayView; words: Words; tenantId: string; mockLive: { caller: string } | null }) {
  const t = makeT(words);
  const live = useLiveCall(tenantId, mockLive) !== null;
  const summary = [view.handled !== null ? t("tv6.day.handled", { n: view.handled }) : null, view.sent !== null ? t("tv6.day.sent", { n: view.sent }) : null, view.next ? t("tv6.day.next", { n: view.next.n, time: view.next.time }) : null].filter((x) => x !== null);
  const newest = view.calls.length - 1;
  return (
    <section data-part="your-day" aria-labelledby="your-day-h" className="min-w-0 rounded-[20px] border border-line bg-surface px-5 pb-2.5 pt-4 shadow-[var(--v2-shadow)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[12.5px] text-muted">
        <h2 id="your-day-h" className="min-w-0">
          <b className="mr-2.5 font-display text-[15px] text-ink">{t("tv6.day.title")}</b>
          {summary.length > 0 ? <span data-part="day-summary">{summary.join(" · ")}</span> : null}
        </h2>
        <p className="flex gap-3.5 text-[11.5px]" aria-hidden="true">
          <span>
            <i className="mr-1.5 inline-block size-[7px] rounded-full bg-brand align-[1px]" />
            {t("tv6.day.calls")}
          </span>
          <span>
            <i className="mr-1.5 inline-block size-[7px] rounded-full bg-green-text align-[1px]" />
            {t("tv6.day.visits")}
          </span>
          <span>
            <i className="mr-1.5 inline-block size-[7px] rounded-full border-[1.5px] border-dashed border-edge align-[1px]" />
            {t("tv6.day.planned")}
          </span>
        </p>
      </div>
      <div className="ds-day-scroll -mx-5 overflow-x-auto px-5 pb-2">
        <div data-part="day-track" className="relative mt-2 h-[112px] min-w-[760px] md:min-w-0 [@media(max-height:860px)]:md:h-[96px]">
          <div className="absolute inset-x-0 top-[10px] h-[62px] [@media(max-height:860px)]:md:top-[6px]">
            {[0, 8.33, 16.67, 25, 33.33, 41.67, 50, 58.33, 66.67, 75, 83.33, 91.67, 100].map((x) => (
              <At key={x} s={{ left: `${x}%`, top: 0, bottom: 10 }}>
                <i className="block h-full w-px bg-line" />
              </At>
            ))}
            <span aria-hidden="true" className="absolute inset-x-0 bottom-[10px] h-px bg-line" />
            {view.now ? (
              <At s={{ left: 0, bottom: 10, width: `${view.now.pct}%` }}>
                <i className="block h-0.5 w-full rounded-sm bg-gradient-to-r from-brand/20 to-brand" />
              </At>
            ) : null}
            {view.calls.map((c, i) => (
              <At key={i} s={{ left: `${c.pct}%`, bottom: 10 + c.lane * 7 }}>
                <i data-dot="call" className={`block size-2 -translate-x-1/2 rounded-full bg-brand shadow-[0_0_6px_rgba(251,146,60,0.6)] ${live && i === newest ? "ds-pulse-dot" : ""}`} />
              </At>
            ))}
            {view.planned.map((x, i) => (
              <At key={i} s={{ left: `${x}%`, bottom: 7 }}>
                <i data-dot="planned" className="block size-[7px] -translate-x-1/2 rounded-full border-[1.5px] border-dashed border-edge" />
              </At>
            ))}
            {view.visits.map((v, i) => (
              <At key={i} s={{ left: `${v.pct}%`, bottom: 20 }}>
                <span data-pin="visit" className="flex -translate-x-1/2 flex-col items-center whitespace-nowrap">
                  <b className="ds-pin">{v.name}</b>
                  <em className="mt-0.5 text-[10.5px] not-italic text-green-text">{v.time}</em>
                  <i className="ds-pin-stem" />
                </span>
              </At>
            ))}
            {view.now ? (
              <At s={{ left: `${view.now.pct}%`, top: -4, bottom: 0 }}>
                <span data-part="now-line" className="relative block h-full w-0.5 -translate-x-1/2 bg-ink">
                  <span className="absolute right-1.5 top-0.5 whitespace-nowrap rounded-md bg-ink px-1.5 text-[10.5px] font-extrabold text-bg">{t("tv6.day.now", { time: view.now.time })}</span>
                </span>
              </At>
            ) : null}
          </div>
          <div className="absolute inset-x-0 bottom-[-4px] h-3.5" aria-hidden="true">
            {view.hours.map((h) => (
              <At key={h.label} s={{ left: `${h.pct}%` }}>
                <span className="block -translate-x-1/2 text-[11px] text-muted">{h.label}</span>
              </At>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
