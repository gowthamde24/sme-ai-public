"use client";

import * as React from "react";

import type { Slots } from "@/lib/api/visits";

import type { SlotsResult } from "./actions-types";
import { dayHeading, isDay } from "./dates";
import { say, type TodayWords } from "../today/today-words";
import { closedWord } from "./closed-word";

export type SlotChoice = { date: string; slot: string | null };

const input = "min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge";

/**
 * Pick a day and one of its free times. The slots of a day are asked for when the day changes (`load`), never guessed: a full slot cannot be chosen, an earlier slot of today can (a walk-in being
 * written down) and says so. `min` is the first day that can be picked (today). A day with no slots says why. The choice is reported as `{date, slot}`; the slot is null until one is chosen.
 */
export function SlotPicker({ words, lang, min, value, onChange, load, initial = null, idPrefix }: { words: TodayWords; lang: string; min: string; value: SlotChoice; onChange: (v: SlotChoice) => void; load: (date: string) => Promise<SlotsResult>; initial?: Slots | null; idPrefix: string }) {
  // the answers by day: a day not in the map is still being asked (state is only set when an answer arrives)
  const [byDay, setByDay] = React.useState<Record<string, Slots | "error">>(initial ? { [initial.date]: initial } : {});
  const answer = byDay[value.date];
  const state: "loading" | "ready" | "error" = answer === undefined ? "loading" : answer === "error" ? "error" : "ready";
  const slots = answer === undefined || answer === "error" ? null : answer;

  React.useEffect(() => {
    if (!isDay(value.date) || value.date in byDay) return;
    let live = true;
    const day = value.date;
    load(day)
      .catch((): SlotsResult => ({ ok: false, error: "" }))
      .then((result) => {
        if (live) setByDay((m) => ({ ...m, [day]: result.ok ? result.slots : "error" }));
      });
    return () => {
      live = false;
    };
  }, [value.date, load, byDay]);

  const free = slots?.slots ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor={`${idPrefix}-date`} className="mb-1.5 block text-sm font-semibold">
          {say(words, "visits.slot.day")}
        </label>
        <input id={`${idPrefix}-date`} type="date" min={min} value={value.date} onChange={(e) => onChange({ date: e.target.value, slot: null })} className={input} />
        {isDay(value.date) ? <p className="mt-1.5 text-sm text-muted">{dayHeading(value.date, lang)}</p> : null}
      </div>
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-sm font-semibold">{say(words, "visits.slot.time")}</legend>
        {!isDay(value.date) ? (
          <p className="text-sm text-muted">{say(words, "visits.slot.pickday")}</p>
        ) : state === "loading" ? (
          <p role="status" className="text-sm text-muted">
            {say(words, "visits.slot.loading")}
          </p>
        ) : state === "error" || slots === null ? (
          <p role="alert" className="text-sm font-medium text-red-text">
            {say(words, "visits.slot.error")}
          </p>
        ) : free.length === 0 ? (
          <p className="text-sm text-muted">{closedWord(words, slots.reason)}</p>
        ) : (
          <div role="group" aria-label={say(words, "visits.slot.time")} className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4">
            {free.map((s) => {
              const full = s.free === 0;
              const on = value.slot === s.start;
              return (
                <button
                  key={s.start}
                  type="button"
                  disabled={full}
                  aria-pressed={on}
                  onClick={() => onChange({ date: value.date, slot: s.start })}
                  className={`flex min-h-12 flex-col items-center justify-center rounded-lg border px-1 text-base font-semibold tabular-nums disabled:opacity-50 ${on ? "border-brand-edge bg-brand text-on-brand" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}
                >
                  <span>{s.start}</span>
                  <span className={`text-sm font-normal ${on ? "text-on-brand" : "text-muted"}`}>{full ? say(words, "visits.slot.full") : s.past ? say(words, "visits.slot.earlier") : say(words, "visits.slot.free", { n: s.free })}</span>
                </button>
              );
            })}
          </div>
        )}
      </fieldset>
    </div>
  );
}
