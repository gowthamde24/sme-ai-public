import { ROLE_CODES } from "@/lib/employees/types";

import type { Say } from "../../words";
import type { Draft } from "./draft";

const card = "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-4 has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2";

/** Step 1: the seven roles as cards (one radio group). */
export function StepRole({ t, d, set }: { t: Say; d: Draft; set: (p: Partial<Draft>) => void }) {
  return (
    <fieldset data-part="wiz-role" className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
      <legend className="sr-only">{t("emp.wiz.step.role")}</legend>
      {ROLE_CODES.map((code) => (
        <label key={code} className={card}>
          <input type="radio" name="wiz-role" value={code} checked={d.role === code} onChange={() => set({ role: code })} className="mt-1 size-5 shrink-0 accent-brand-text" />
          <span className="min-w-0">
            <span className="block text-base font-semibold text-ink">{t(`emp.role.${code}`)}</span>
            <span className="mt-1 block text-[15px] text-muted">{t(`emp.role.${code}.d`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
