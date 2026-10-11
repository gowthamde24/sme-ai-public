"use client";

import * as React from "react";

import { SLOT_MINUTES, WEEKDAYS, type DayHours, type StoreSettings, type Weekday } from "@/lib/api/visits";

import { say, type TodayWords } from "../today/today-words";
import type { HoursResult } from "./actions-types";
import { dayShort, isDay, weekdayName } from "./dates";
import { card, errorLine, field, help, label, okLine, primary, quiet, secondary } from "./styles";

const DEFAULT_DAY: DayHours = { open: "10:00", close: "20:30" };

/** Every half hour of the day, `until` included ("24:00" is midnight and is only a closing time). */
function clocks(from: number, until: number): string[] {
  const out: string[] = [];
  for (let m = from; m <= until; m += 30) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}
const OPENS = clocks(0, 23 * 60 + 30);
const CLOSES = clocks(30, 24 * 60);

function Times({ id, value, list, onChange, disabled, name }: { id: string; value: string; list: string[]; onChange: (v: string) => void; disabled: boolean; name: string }) {
  const options = list.includes(value) ? list : [...list, value].sort();
  return (
    <select id={id} aria-label={name} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${field} tabular-nums`}>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

/**
 * The store hours (job AV): which days the shop is open and from when to when, the length of one visit, how many visits can be at once, and the days the shop is closed (holidays). Only the Owner and
 * Admin may change them (the API checks again); everyone else sees them. It changes no visit that is already booked, and says so. Until the business saves its own, the standard hours are shown and say so.
 */
export function HoursForm({ words, lang, settings, canEdit, save }: { words: TodayWords; lang: string; settings: StoreSettings; canEdit: boolean; save: (s: Omit<StoreSettings, "is_default">) => Promise<HoursResult> }) {
  const [week, setWeek] = React.useState<Record<Weekday, DayHours | null>>(settings.weekly_hours);
  const [slot, setSlot] = React.useState(String(settings.slot_minutes));
  const [parallel, setParallel] = React.useState(String(settings.max_parallel));
  const [closed, setClosed] = React.useState<string[]>(settings.closed_dates);
  const [adding, setAdding] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [isDefault, setIsDefault] = React.useState(settings.is_default);

  const parallelNumber = Number(parallel);
  const parallelOk = Number.isInteger(parallelNumber) && parallelNumber >= 1 && parallelNumber <= 50;
  const timesOk = WEEKDAYS.every((d) => week[d] === null || week[d]!.open < week[d]!.close);
  const ready = canEdit && parallelOk && timesOk && !busy;

  const setDay = (d: Weekday, v: DayHours | null) => setWeek((w) => ({ ...w, [d]: v }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    let result: HoursResult;
    try {
      result = await save({ weekly_hours: week, closed_dates: closed, slot_minutes: Number(slot), max_parallel: parallelNumber });
    } catch {
      result = { ok: false, error: say(words, "today.err.generic") };
    }
    setBusy(false);
    if (result.ok) {
      setDone(result.message);
      setIsDefault(false);
    } else setProblem(result.error);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <section aria-labelledby="hours-heading" className={card}>
        <h2 id="hours-heading" className="font-display text-xl font-semibold">
          {say(words, "visits.hours.title")}
        </h2>
        {isDefault ? <p className="rounded-lg bg-info-bg px-3 py-2 text-sm font-medium text-info-text">{say(words, "visits.hours.default")}</p> : null}
        {!canEdit ? <p className="text-sm text-muted">{say(words, "visits.hours.readonly")}</p> : null}
        <ul className="flex flex-col gap-3">
          {WEEKDAYS.map((d, i) => {
            const hours = week[d];
            return (
              <li key={d} className="flex flex-col gap-2 border-b border-line pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                <label className="flex min-h-11 items-center gap-3 sm:w-48">
                  <input type="checkbox" checked={hours !== null} disabled={!canEdit} onChange={(e) => setDay(d, e.target.checked ? DEFAULT_DAY : null)} className="size-6 shrink-0 accent-brand-text" />
                  <span className="font-semibold">{weekdayName(i, lang)}</span>
                </label>
                {hours ? (
                  <div className="flex flex-1 items-center gap-2">
                    <div className="flex-1">
                      <Times id={`open-${d}`} name={`${weekdayName(i, lang)}: ${say(words, "visits.hours.from")}`} value={hours.open} list={OPENS} disabled={!canEdit} onChange={(v) => setDay(d, { ...hours, open: v })} />
                    </div>
                    <span aria-hidden="true" className="text-muted">
                      –
                    </span>
                    <div className="flex-1">
                      <Times id={`close-${d}`} name={`${weekdayName(i, lang)}: ${say(words, "visits.hours.to")}`} value={hours.close} list={CLOSES} disabled={!canEdit} onChange={(v) => setDay(d, { ...hours, close: v })} />
                    </div>
                  </div>
                ) : (
                  <span className="text-muted">{say(words, "visits.hours.closed")}</span>
                )}
              </li>
            );
          })}
        </ul>
        {!timesOk ? <p role="alert" className={errorLine}>{say(words, "visits.hours.order")}</p> : null}
      </section>

      <section aria-labelledby="slots-heading" className={card}>
        <h2 id="slots-heading" className="font-display text-xl font-semibold">
          {say(words, "visits.slots.title")}
        </h2>
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <div>
            <label htmlFor="slot-minutes" className={label}>
              {say(words, "visits.slots.length")}
            </label>
            <select id="slot-minutes" value={slot} disabled={!canEdit} onChange={(e) => setSlot(e.target.value)} className={field}>
              {SLOT_MINUTES.map((m) => (
                <option key={m} value={m}>
                  {say(words, "visits.slots.minutes", { n: m })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="slot-parallel" className={label}>
              {say(words, "visits.slots.parallel")}
            </label>
            <input id="slot-parallel" type="number" inputMode="numeric" min={1} max={50} value={parallel} disabled={!canEdit} onChange={(e) => setParallel(e.target.value)} className={field} aria-invalid={!parallelOk} />
            <p className={help}>{say(words, "visits.slots.parallel.hint")}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="closed-heading" className={card}>
        <h2 id="closed-heading" className="font-display text-xl font-semibold">
          {say(words, "visits.closed.title")}
        </h2>
        {closed.length === 0 ? <p className="text-sm text-muted">{say(words, "visits.closed.none")}</p> : null}
        <ul className="flex flex-wrap gap-2">
          {closed.map((d) => (
            <li key={d} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 pl-3">
              <span className="font-semibold tabular-nums">{dayShort(d, lang)} {d.slice(0, 4)}</span>
              {canEdit ? (
                <button type="button" aria-label={say(words, "visits.closed.remove", { date: d })} onClick={() => setClosed((c) => c.filter((x) => x !== d))} className="inline-flex size-11 items-center justify-center rounded-full text-lg font-semibold text-muted hover:bg-line">
                  <span aria-hidden="true">×</span>
                </button>
              ) : (
                <span className="w-3" />
              )}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label htmlFor="closed-add" className={label}>
                {say(words, "visits.closed.add.label")}
              </label>
              <input id="closed-add" type="date" value={adding} onChange={(e) => setAdding(e.target.value)} className={field} />
            </div>
            <button
              type="button"
              disabled={!isDay(adding) || closed.includes(adding) || closed.length >= 200}
              onClick={() => {
                setClosed((c) => [...c, adding].sort());
                setAdding("");
              }}
              className={secondary}
            >
              {say(words, "visits.closed.add")}
            </button>
          </div>
        ) : null}
      </section>

      {problem ? <p role="alert" className={errorLine}>{problem}</p> : null}
      {done ? <p role="status" className={okLine}>{done}</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!ready} className={primary}>
            {busy ? say(words, "today.act.working") : say(words, "visits.hours.save")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setWeek(settings.weekly_hours);
              setSlot(String(settings.slot_minutes));
              setParallel(String(settings.max_parallel));
              setClosed(settings.closed_dates);
              setProblem(null);
              setDone(null);
            }}
            className={quiet}
          >
            {say(words, "visits.hours.reset")}
          </button>
          <p className="basis-full text-sm text-muted">{say(words, "visits.hours.note")}</p>
        </div>
      ) : null}
    </form>
  );
}
