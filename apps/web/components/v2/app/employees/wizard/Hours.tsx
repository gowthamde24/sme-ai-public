import { fieldHelp, fieldInput, radioRow } from "../../ui";
import type { Say } from "../../words";
import type { Draft } from "./draft";

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const dayBox = "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface px-3 text-base font-semibold has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2";

/** Working hours: the same as the business, or only some days and times (never wider than 10:00 to 21:00; the API checks it again). */
export function Hours({ t, d, set }: { t: Say; d: Draft; set: (p: Partial<Draft>) => void }) {
  const only = d.hoursMode === "only";
  const flip = (n: number) => set({ days: d.days.includes(n) ? d.days.filter((x) => x !== n) : [...d.days, n].sort((a, b) => a - b) });
  return (
    <fieldset data-part="wiz-hours" className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <legend className="px-1 text-base font-semibold text-ink">{t("emp.wiz.hours.h")}</legend>
      <label className={radioRow}>
        <input type="radio" name="wiz-hours" checked={!only} onChange={() => set({ hoursMode: "same" })} className="size-5 accent-brand-text" />
        {t("emp.hours.same")}
      </label>
      <label className={radioRow}>
        <input type="radio" name="wiz-hours" checked={only} onChange={() => set({ hoursMode: "only" })} className="size-5 accent-brand-text" />
        {t("emp.hours.only")}
      </label>
      {only ? (
        <div className="flex flex-col gap-3 pl-1">
          <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold text-muted">{t("emp.hours.days")}</legend>
            {DAYS.map((n) => (
              <label key={n} className={dayBox}>
                <input type="checkbox" checked={d.days.includes(n)} onChange={() => flip(n)} className="sr-only" />
                {t(`emp.day.${n}`)}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="wiz-from" className="mb-1 block text-sm font-semibold text-muted">
                {t("emp.hours.from")}
              </label>
              <input id="wiz-from" type="time" min="10:00" max="21:00" value={d.from} onChange={(e) => set({ from: e.target.value })} className={`${fieldInput} w-36`} />
            </div>
            <div>
              <label htmlFor="wiz-to" className="mb-1 block text-sm font-semibold text-muted">
                {t("emp.hours.to")}
              </label>
              <input id="wiz-to" type="time" min="10:00" max="21:00" value={d.to} onChange={(e) => set({ to: e.target.value })} className={`${fieldInput} w-36`} />
            </div>
          </div>
        </div>
      ) : null}
      <p className={`${fieldHelp} m-0`}>{t("emp.hours.note")}</p>
    </fieldset>
  );
}
