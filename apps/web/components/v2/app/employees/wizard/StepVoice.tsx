import { Loader2, Pause, Play } from "lucide-react";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";

import { btnQuiet, checkBox, fieldHelp } from "../../ui";
import type { Say } from "../../words";
import { WIZARD_LANGS, voicesFor, type Draft, type VoiceCatalogue, type WizardLang } from "./draft";

const chip = "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-4 text-base font-semibold has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg";
const row = "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg";

export type VoiceStepProps = {
  t: Say;
  d: Draft;
  catalogue: VoiceCatalogue;
  toggleLang: (l: WizardLang) => void;
  pick: (l: WizardLang, voiceId: string) => void;
  play: (l: WizardLang) => void;
  playing: WizardLang | null;
  loading: WizardLang | null;
};

/** Step 3: the languages it speaks, and for each one a voice of the catalogue with a Play sample button. A voice for one language never changes the others. */
export function StepVoice({ t, d, catalogue, toggleLang, pick, play, playing, loading }: VoiceStepProps) {
  return (
    <div data-part="wiz-voice" className="flex flex-col gap-5">
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="mb-2 text-base font-semibold text-ink">{t("emp.wiz.voice.langs")}</legend>
        {WIZARD_LANGS.map((l) => (
          <label key={l} className={chip}>
            <input type="checkbox" checked={d.languages.includes(l)} onChange={() => toggleLang(l)} className={checkBox} />
            {CALL_LANG_NAMES[l]}
          </label>
        ))}
      </fieldset>
      <p className="m-0 text-[15px] text-muted">{t("vc.per_language", { language: CALL_LANG_NAMES[d.languages[0] ?? "te"] })}</p>
      {WIZARD_LANGS.filter((l) => d.languages.includes(l)).map((l) => {
        const voices = voicesFor(catalogue, l);
        const chosen = d.voices[l];
        const name = CALL_LANG_NAMES[l];
        const on = playing === l;
        return (
          <fieldset key={l} data-part="wiz-voice-lang" data-lang={l} className="m-0 flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <legend className="px-1 text-base font-semibold text-ink">{t("emp.wiz.voice.pick", { language: name })}</legend>
            {voices.length === 0 ? (
              <p className={`${fieldHelp} m-0`}>{t("emp.wiz.voice.none", { language: name })}</p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {voices.map((v) => (
                    <label key={v.id} className={row}>
                      <input type="radio" name={`wiz-voice-${l}`} value={v.id} checked={chosen === v.id} onChange={() => pick(l, v.id)} className="size-5 shrink-0 accent-brand-text" />
                      <span className="min-w-0 text-base">
                        <span className="font-semibold text-ink">{v.name}</span>
                        <span className="text-muted">{` · ${[v.label, t(v.gender === "female" ? "vc.woman" : "vc.man")].filter((x) => x !== "").join(" · ")}`}</span>
                        {v.recommended ? <span className="ml-1 text-sm font-semibold text-brand-text">{t("emp.wiz.voice.recommended")}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => play(l)} disabled={!chosen} data-part="wiz-play" aria-pressed={on} className={btnQuiet}>
                    {loading === l ? <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" /> : on ? <Pause aria-hidden="true" className="mr-2 size-4" /> : <Play aria-hidden="true" className="mr-2 size-4" />}
                    {loading === l ? t("emp.wiz.voice.loading") : on ? t("emp.wiz.voice.stop") : t("vc.play_sample")}
                  </button>
                  {!chosen ? <span className="text-sm text-muted">{t("vc.later")}</span> : null}
                </div>
              </>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
