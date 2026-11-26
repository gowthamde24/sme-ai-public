import { ASK_FIRST, INSTRUCTIONS_MAX, type AskFirst } from "@/lib/employees/types";

import { checkBox, checkRow, fieldHelp, fieldTextarea } from "../../ui";
import type { Say } from "../../words";
import type { Draft } from "./draft";
import { Hours } from "./Hours";
import { NeverSay } from "./NeverSay";

const section = "flex flex-col gap-2 rounded-xl border border-line bg-surface p-4";

/** Step 4: what it asks first (the rest it does on its own), its working hours, the words it never says, and its extra instructions. */
export function StepRules({ t, d, set }: { t: Say; d: Draft; set: (p: Partial<Draft>) => void }) {
  const flip = (a: AskFirst) => set({ askFirst: ASK_FIRST.filter((x) => (x === a ? !d.askFirst.includes(a) : d.askFirst.includes(x))) });
  return (
    <div data-part="wiz-rules" className="flex flex-col gap-4">
      <fieldset className={section}>
        <legend className="px-1 text-base font-semibold text-ink">{t("emp.wiz.ask.h")}</legend>
        <p className={`${fieldHelp} m-0`}>{t("emp.wiz.ask.d")}</p>
        {ASK_FIRST.map((a) => (
          <label key={a} className={checkRow}>
            <input type="checkbox" checked={d.askFirst.includes(a)} onChange={() => flip(a)} className={checkBox} />
            {t(`emp.ask.${a}`)}
          </label>
        ))}
      </fieldset>
      <Hours t={t} d={d} set={set} />
      <NeverSay t={t} d={d} set={set} />
      <section className={section}>
        <label htmlFor="wiz-instr" className="m-0 text-base font-semibold text-ink">
          {t("emp.wiz.instr.h")}
        </label>
        <p id="wiz-instr-d" className={`${fieldHelp} m-0`}>
          {t("emp.wiz.instr.d")}
        </p>
        <textarea id="wiz-instr" rows={5} value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} aria-describedby="wiz-instr-d wiz-instr-count" className={fieldTextarea} />
        <p id="wiz-instr-count" data-part="wiz-instr-count" aria-live="polite" className={`m-0 text-sm ${d.instructions.length > INSTRUCTIONS_MAX ? "font-semibold text-red-text" : "text-muted"}`}>
          {t("emp.wiz.instr.count", { n: d.instructions.length, max: INSTRUCTIONS_MAX })}
        </p>
      </section>
    </div>
  );
}
