"use client";

import * as React from "react";

import { EMPLOYEE_LANGUAGES, STYLES, type EmployeePatch, type EmployeeStyle } from "@/lib/employees/types";
import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { Radio, Tick } from "../../ds/Tick";
import { fieldHelp, fieldLabel } from "../../ui";
import { makeT } from "../../words";
import { Card, SaveBar, same, useSave, type TabProps } from "./shared";

export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.3;

/** The languages it speaks: at least one of the four. */
export function LanguagesCard({ emp, words, canEdit, actions, onChange }: TabProps) {
  const t = makeT(words);
  const [picked, setPicked] = React.useState<string[]>([...emp.languages]);
  const save = useSave(onChange);
  const ordered = EMPLOYEE_LANGUAGES.filter((l) => picked.includes(l));
  const changed = !same([...emp.languages].sort(), [...ordered].sort());
  const flip = (l: string) => {
    save.clear();
    setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  };
  return (
    <Card title={t("emp.page.voice.langs")} desc={t("emp.page.voice.langs_help")}>
      <div role="group" aria-label={t("emp.page.voice.langs")} className="flex flex-wrap gap-x-6">
        {EMPLOYEE_LANGUAGES.map((l) => (
          <Tick key={l} label={CALL_LANG_NAMES[l as CallLang]} checked={picked.includes(l)} disabled={!canEdit} onChange={() => flip(l)} />
        ))}
      </div>
      {canEdit ? <SaveBar words={words} state={save} onSave={() => (ordered.length === 0 ? save.fail("validation_error") : void save.run(() => actions.patch({ languages: ordered })))} disabled={!changed} /> : null}
    </Card>
  );
}

/** How it speaks: the style (four plain choices), the speed (0.7 to 1.3) and the two language switches. One Save sends only what changed. */
export function SpeakCard({ emp, words, canEdit, actions, onChange }: TabProps) {
  const t = makeT(words);
  const [style, setStyle] = React.useState<EmployeeStyle | null>(emp.style);
  const [speed, setSpeed] = React.useState<number | null>(emp.speed);
  const [auto, setAuto] = React.useState(emp.autoSwitchLanguage);
  const [mix, setMix] = React.useState(emp.allowEnglishMixing);
  const save = useSave(onChange);
  const patch = (): EmployeePatch => {
    const p: EmployeePatch = {};
    if (style !== emp.style && style !== null) p.style = style;
    if (speed !== emp.speed && speed !== null) p.speed = speed;
    if (auto !== emp.autoSwitchLanguage) p.autoSwitchLanguage = auto;
    if (mix !== emp.allowEnglishMixing) p.allowEnglishMixing = mix;
    return p;
  };
  const p = patch();
  const touch = () => save.clear();
  return (
    <Card title={t("emp.page.voice.speaks")}>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={fieldLabel}>{t("emp.page.voice.style")}</legend>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {STYLES.map((s) => (
            <Radio key={s} name="emp-style" label={t(`emp.page.style.${s}`)} checked={style === s} disabled={!canEdit} onChange={() => (setStyle(s), touch())} />
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="emp-speed" className={fieldLabel}>
          {t("emp.page.voice.speed")}: <output>{(speed ?? 1).toFixed(2)}</output>
        </label>
        <input id="emp-speed" type="range" min={SPEED_MIN} max={SPEED_MAX} step={0.05} value={speed ?? 1} disabled={!canEdit} onChange={(e) => (setSpeed(Number(e.target.value)), touch())} aria-describedby="emp-speed-help" className="h-11 w-full accent-brand-text" />
        <p id="emp-speed-help" className={fieldHelp}>
          {t("emp.page.voice.speed_help", { min: SPEED_MIN, max: SPEED_MAX })}
        </p>
      </div>
      <div>
        <Tick role="switch" label={t("emp.page.voice.auto")} sub={t("emp.page.voice.auto_help")} checked={auto} disabled={!canEdit} onChange={(e) => (setAuto(e.target.checked), touch())} />
        <Tick role="switch" label={t("emp.page.voice.mix")} sub={t("emp.page.voice.mix_help")} checked={mix} disabled={!canEdit} onChange={(e) => (setMix(e.target.checked), touch())} />
      </div>
      {canEdit ? <SaveBar words={words} state={save} onSave={() => void save.run(() => actions.patch(p))} disabled={Object.keys(p).length === 0} /> : null}
    </Card>
  );
}
