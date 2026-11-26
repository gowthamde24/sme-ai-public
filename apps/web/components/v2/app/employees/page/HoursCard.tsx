"use client";

import * as React from "react";

import { WINDOW_FROM, WINDOW_TO, hhmm, hoursOk, minuteOf, type Hours } from "@/lib/employees/types";

import { Radio, Tick } from "../../ds/Tick";
import { fieldHelp, fieldInput, fieldLabel } from "../../ui";
import { makeT } from "../../words";
import { Card, SaveBar, same, useSave, type TabProps } from "./shared";

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Working hours: the same as the business, or only some days and times, never wider than 10:00 to 21:00 (they can only narrow the legal calling window). */
export function HoursCard({ emp, words, actions, onChange, locked }: TabProps & { locked: boolean }) {
  const t = makeT(words);
  const h = emp.hours;
  const [only, setOnly] = React.useState(h !== null);
  const [days, setDays] = React.useState<number[]>(h ? [...h.days] : [...DAYS]);
  const [from, setFrom] = React.useState(hhmm(h?.fromMinute ?? WINDOW_FROM));
  const [to, setTo] = React.useState(hhmm(h?.toMinute ?? WINDOW_TO));
  const save = useSave(onChange);
  const next: Hours | null = only ? { days: [...days].sort((a, b) => a - b), fromMinute: minuteOf(from) ?? -1, toMinute: minuteOf(to) ?? -1 } : null;
  const changed = !same(next, h);
  const submit = () => {
    if (next && !hoursOk(next)) return save.fail(next.fromMinute < WINDOW_FROM || next.toMinute > WINDOW_TO || next.toMinute > 1440 ? "hours_wider" : "validation_error");
    void save.run(() => actions.patch({ hours: next }));
  };
  const touch = () => save.clear();
  return (
    <Card title={t("emp.page.hours")} desc={t("emp.page.hours_help")}>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{t("emp.page.hours")}</legend>
        <Radio name="emp-hours" label={t("emp.page.hours.same")} checked={!only} disabled={locked} onChange={() => (setOnly(false), touch())} />
        <Radio name="emp-hours" label={t("emp.page.hours.only")} checked={only} disabled={locked} onChange={() => (setOnly(true), touch())} />
      </fieldset>
      {only ? (
        <>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">{t("emp.page.hours.days")}</legend>
            <div className="flex flex-wrap gap-x-4">
              {DAYS.map((d) => (
                <Tick key={d} label={t(`emp.day.${d}`)} checked={days.includes(d)} disabled={locked} onChange={(e) => (setDays((p) => (e.target.checked ? [...p, d] : p.filter((x) => x !== d))), touch())} />
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="emp-from" className={fieldLabel}>
                {t("emp.page.hours.from")}
              </label>
              <input id="emp-from" type="time" value={from} min="10:00" max="21:00" disabled={locked} onChange={(e) => (setFrom(e.target.value), touch())} className={fieldInput} />
            </div>
            <div>
              <label htmlFor="emp-to" className={fieldLabel}>
                {t("emp.page.hours.to")}
              </label>
              <input id="emp-to" type="time" value={to} min="10:00" max="21:00" disabled={locked} onChange={(e) => (setTo(e.target.value), touch())} className={fieldInput} />
            </div>
          </div>
          <p className={`${fieldHelp} mt-0`}>{t("emp.page.hours.outside")}</p>
        </>
      ) : null}
      {!locked ? <SaveBar words={words} state={save} onSave={submit} disabled={!changed} /> : null}
    </Card>
  );
}
