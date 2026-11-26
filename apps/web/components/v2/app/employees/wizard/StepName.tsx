import { NAME_MAX } from "@/lib/employees/types";

import { fieldHelp, fieldInput, fieldLabel } from "../../ui";
import type { Say } from "../../words";
import type { Draft } from "./draft";

/** Step 2: the name. Nothing is made up for it: the box starts empty. */
export function StepName({ t, d, set, invalid }: { t: Say; d: Draft; set: (p: Partial<Draft>) => void; invalid: boolean }) {
  return (
    <div data-part="wiz-name" className="max-w-md">
      <label htmlFor="wiz-name" className={fieldLabel}>
        {t("emp.wiz.step.name")}
      </label>
      <input id="wiz-name" type="text" value={d.name} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => set({ name: e.target.value })} aria-invalid={invalid} aria-describedby="wiz-name-hint wiz-error" className={fieldInput} />
      <p id="wiz-name-hint" className={fieldHelp}>
        {t("emp.wiz.name.hint", { max: NAME_MAX })}
      </p>
    </div>
  );
}
