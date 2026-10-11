"use client";

import * as React from "react";

import { SLOT_MINUTES, WEEKDAYS, type DayHours, type StoreSettings, type Weekday } from "@/lib/api/visits";

import { say, type TodayWords } from "../today/today-words";
import { weekdayName } from "../visits/dates";
import { errorLine, field, label, okLine, primary } from "../visits/styles";
import { SHOP_DEFAULTS } from "./setup-logic";
import type { SetupActions } from "./types";

const PARALLEL = [1, 2, 3, 4, 5, 6, 8, 10];
const clocks = (from: number, until: number): string[] => {
  const out: string[] = [];
  for (let m = from; m <= until; m += 30) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
};
const OPENS = clocks(6 * 60, 23 * 60);
const CLOSES = clocks(7 * 60, 24 * 60);
const DAY_CHIP =
  "inline-flex min-h-11 min-w-12 items-center justify-center rounded-full border border-edge px-3 text-base has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg has-[:checked]:font-semibold has-[:checked]:text-brand-text";

/** Where the form starts: the business's own saved hours, or, when it has none, usual saree-shop hours (Monday to Saturday, 10:00 to 20:30). One opening and closing time for every open day. */
export function startingHours(settings: StoreSettings | null, saved: boolean): { days: Weekday[]; open: string; close: string; slot: number; parallel: number } {
  if (settings && saved) {
    const first = WEEKDAYS.map((d) => settings.weekly_hours[d]).find((h): h is DayHours => h !== null);
    return { days: WEEKDAYS.filter((d) => settings.weekly_hours[d] !== null), open: first?.open ?? SHOP_DEFAULTS.open, close: first?.close ?? SHOP_DEFAULTS.close, slot: settings.slot_minutes, parallel: settings.max_parallel };
  }
  return { days: [...SHOP_DEFAULTS.days], open: SHOP_DEFAULTS.open, close: SHOP_DEFAULTS.close, slot: SHOP_DEFAULTS.slot, parallel: SHOP_DEFAULTS.parallel };
}

/** Step 2 (the AS API, `PUT /visits/settings`): which days the shop is open, from when to when, how long a visit is and how many at once. Saves the whole week through the same action as the Visits page. */
export function HoursStep({ words, lang, settings, saved, closedDates, save, onSaved }: { words: TodayWords; lang: string; settings: StoreSettings | null; saved: boolean; closedDates: string[]; save: SetupActions["saveHours"]; onSaved: () => void }) {
  const start = React.useMemo(() => startingHours(settings, saved), [settings, saved]);
  const [days, setDays] = React.useState<Weekday[]>(start.days);
  const [open, setOpen] = React.useState(start.open);
  const [close, setClose] = React.useState(start.close);
  const [slot, setSlot] = React.useState(String(start.slot));
  const [parallel, setParallel] = React.useState(String(start.parallel));
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setDone(null);
    if (days.length === 0) return setProblem(say(words, "setup.s2.err.days"));
    if (open >= close) return setProblem(say(words, "visits.hours.order"));
    setProblem(null);
    setBusy(true);
    const week = Object.fromEntries(WEEKDAYS.map((d) => [d, days.includes(d) ? { open, close } : null])) as Record<Weekday, DayHours | null>;
    const out = await save({ weekly_hours: week, closed_dates: closedDates, slot_minutes: Number(slot), max_parallel: Number(parallel) });
    setBusy(false);
    if (!out.ok) return setProblem(out.error);
    setDone(out.message);
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-step="hours">
      <fieldset>
        <legend className={label}>{say(words, "setup.s2.days")}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className={DAY_CHIP}>
              <input type="checkbox" className="sr-only" checked={days.includes(d)} onChange={(e) => setDays((cur) => (e.target.checked ? [...cur, d] : cur.filter((x) => x !== d)))} />
              {weekdayName(i, lang).slice(0, lang === "en" ? 3 : 4)}
              <span className="sr-only">{weekdayName(i, lang)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="setup-open" className={label}>
            {say(words, "setup.s2.opens")}
          </label>
          <select id="setup-open" value={open} onChange={(e) => setOpen(e.target.value)} className={`${field} tabular-nums`}>
            {(OPENS.includes(open) ? OPENS : [...OPENS, open].sort()).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="setup-close" className={label}>
            {say(words, "setup.s2.closes")}
          </label>
          <select id="setup-close" value={close} onChange={(e) => setClose(e.target.value)} className={`${field} tabular-nums`}>
            {(CLOSES.includes(close) ? CLOSES : [...CLOSES, close].sort()).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="setup-slot" className={label}>
            {say(words, "setup.s2.slot")}
          </label>
          <select id="setup-slot" value={slot} onChange={(e) => setSlot(e.target.value)} className={field}>
            {SLOT_MINUTES.map((m) => (
              <option key={m} value={m}>
                {say(words, "setup.s2.slot.opt", { n: m })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="setup-parallel" className={label}>
            {say(words, "setup.s2.parallel")}
          </label>
          <select id="setup-parallel" value={parallel} onChange={(e) => setParallel(e.target.value)} className={field}>
            {(PARALLEL.includes(Number(parallel)) ? PARALLEL : [...PARALLEL, Number(parallel)].sort((a, b) => a - b)).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      {problem ? (
        <p role="alert" className={errorLine}>
          {problem}
        </p>
      ) : null}
      {done ? (
        <p role="status" className={okLine}>
          {done}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={busy} className={primary}>
          {say(words, "visits.hours.save")}
        </button>
      </div>
    </form>
  );
}
