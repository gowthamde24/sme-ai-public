import { Loader2, Pause, Play } from "lucide-react";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import type { Employee } from "@/lib/employees/types";

import { btnQuiet } from "../../ui";
import type { Say } from "../../words";
import { WIZARD_LANGS, type Draft, type WizardLang } from "./draft";

/** Step 6: the opening line in each language, in the voice that was picked (Play). The line is shown once the API has said it. */
export function StepPreview({ t, d, employee, said, play, playing, loading }: { t: Say; d: Draft; employee: Employee | null; said: Partial<Record<WizardLang, string>>; play: (l: WizardLang) => void; playing: WizardLang | null; loading: WizardLang | null }) {
  return (
    <div data-part="wiz-preview" className="flex flex-col gap-4">
      <p className="m-0 text-[15px] text-muted">{t("emp.wiz.preview.d")}</p>
      {WIZARD_LANGS.filter((l) => d.languages.includes(l)).map((l) => {
        const line = said[l] ?? employee?.openingLine[l] ?? null;
        const on = playing === l;
        return (
          <section key={l} data-part="wiz-preview-lang" data-lang={l} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <h3 className="m-0 text-base font-semibold text-ink">{CALL_LANG_NAMES[l]}</h3>
            {line ? (
              <p className="m-0 text-base text-ink [overflow-wrap:anywhere]">
                <span className="text-muted">{t("emp.wiz.preview.said")} </span>
                {line}
              </p>
            ) : null}
            <div>
              <button type="button" onClick={() => play(l)} data-part="wiz-play" aria-pressed={on} className={btnQuiet}>
                {loading === l ? <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" /> : on ? <Pause aria-hidden="true" className="mr-2 size-4" /> : <Play aria-hidden="true" className="mr-2 size-4" />}
                {loading === l ? t("emp.wiz.voice.loading") : on ? t("emp.wiz.voice.stop") : t("vc.play_sample")}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
