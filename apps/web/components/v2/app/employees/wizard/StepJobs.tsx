import { RESPONSIBILITIES, ROLE_TITLE_MAX, ROLE_TITLE_MIN } from "@/lib/employees/types";

import { checkBox, checkRow, fieldHelp, fieldInput, fieldLabel } from "../../ui";
import type { Say } from "../../words";
import type { Draft } from "./draft";

/** Step 5: the nine jobs as a checklist (the role's starting set is ticked) and an optional role title. */
export function StepJobs({ t, d, set }: { t: Say; d: Draft; set: (p: Partial<Draft>) => void }) {
  const flip = (id: string) => set({ respTouched: true, responsibilities: RESPONSIBILITIES.filter((x) => (x === id ? !d.responsibilities.includes(id) : d.responsibilities.includes(x))) });
  return (
    <div data-part="wiz-jobs" className="flex flex-col gap-5">
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="sr-only">{t("emp.wiz.step.jobs")}</legend>
        <p className={`${fieldHelp} mb-2 mt-0`}>{t("emp.wiz.jobs.d")}</p>
        {RESPONSIBILITIES.map((id) => (
          <label key={id} className={checkRow}>
            <input type="checkbox" checked={d.responsibilities.includes(id)} onChange={() => flip(id)} className={checkBox} />
            {t(`emp.resp.${id}`)}
          </label>
        ))}
      </fieldset>
      <div className="max-w-md">
        <label htmlFor="wiz-title" className={fieldLabel}>
          {t("emp.wiz.title_field.label")}
        </label>
        <input id="wiz-title" type="text" value={d.roleTitle} maxLength={ROLE_TITLE_MAX} autoComplete="off" onChange={(e) => set({ roleTitle: e.target.value })} aria-describedby="wiz-title-d" className={fieldInput} />
        <p id="wiz-title-d" className={fieldHelp}>
          {t("emp.wiz.title_field.d", { min: ROLE_TITLE_MIN, max: ROLE_TITLE_MAX })}
        </p>
      </div>
    </div>
  );
}
