"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";

import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { btnQuiet, fieldHelp, fieldInput, fieldLabel, pillBrand } from "../../ui";
import { makeT } from "../../words";
import { Card, SaveBar, useSave, type CatalogueVoice, type TabProps } from "./shared";
import type { Player } from "./usePlayer";

const OPENING_MIN = 10;
const OPENING_MAX = 300;
const playBtn = "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 text-[15px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-50";

/** One voice for each name (a narration variant shares its name with the plain voice), women first, then men. */
function listFor(catalogue: readonly CatalogueVoice[], lang: string, current: string | undefined): CatalogueVoice[] {
  const mine = catalogue.filter((v) => v.language === lang);
  const one = mine.filter((v) => (mine.filter((x) => x.name === v.name).find((x) => x.id === current) ?? mine.find((x) => x.name === v.name)) === v);
  return [...one.filter((v) => v.gender === "female"), ...one.filter((v) => v.gender === "male")];
}

/** The card of ONE language: the voice in use, the voices to choose from (each with Play), "Saved: Ramya for Telugu." with Play sample, and the opening line with Play. */
export function VoiceLanguage({ lang, emp, words, canEdit, actions, onChange, catalogue, sampleEndpoint, player }: TabProps & { lang: string; catalogue: readonly CatalogueVoice[] | null; sampleEndpoint: string; player: Player }) {
  const t = makeT(words);
  const language = CALL_LANG_NAMES[lang as CallLang] ?? lang;
  const current = emp.voices[lang];
  const voices = catalogue ? listFor(catalogue, lang, current) : [];
  const nameOf = (id: string | undefined) => (id ? (catalogue?.find((v) => v.id === id)?.name ?? id) : null);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [voiceError, setVoiceError] = React.useState<string | null>(null);
  const [text, setText] = React.useState(emp.openingLine[lang] ?? "");
  const line = useSave(onChange);
  const trimmed = text.trim();
  const lineOk = trimmed === "" || (trimmed.length >= OPENING_MIN && trimmed.length <= OPENING_MAX);
  const lineChanged = trimmed !== (emp.openingLine[lang] ?? "");

  const use = async (v: CatalogueVoice) => {
    setChosen(null);
    setVoiceError(null);
    player.stop();
    try {
      const out = await actions.setVoice(lang, v.id);
      if (out.ok) {
        onChange(out.data);
        setChosen(v.name);
      } else setVoiceError(out.error);
    } catch {
      setVoiceError("unavailable");
    }
  };
  const saveLine = () => {
    if (!lineOk) return line.fail("validation_error");
    const map = { ...emp.openingLine };
    if (trimmed === "") delete map[lang];
    else map[lang] = trimmed;
    void line.run(() => actions.patch({ openingLine: map }));
  };

  return (
    <Card title={language} desc={nameOf(current) ? t("emp.page.voice.current", { name: nameOf(current) ?? "" }) : t("emp.page.voice.none")} id={`emp-voice-${lang}`}>
      {voices.length > 0 ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-xl border border-line p-0" data-part="emp-voices">
          {voices.map((v) => {
            const inUse = v.id === current;
            const key = `row:${v.id}`;
            const here = player.playing === key;
            return (
              <li key={v.id} data-voice={v.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 text-base font-semibold text-ink">
                  {v.name}
                  {v.recommended ? <span className={`${pillBrand} ml-2 align-middle`}>{t("emp.page.voice.recommended")}</span> : null}
                </span>
                <button type="button" onClick={() => player.playUrl(key, `${sampleEndpoint}?id=${encodeURIComponent(v.id)}`)} aria-pressed={here} aria-label={t(here ? "vc.stop.aria" : "vc.play.aria", { name: v.name })} data-play={v.id} className={playBtn}>
                  {here ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
                  {t(here ? "vt.stop" : "vt.play")}
                </button>
                {inUse ? (
                  <span className="inline-flex min-h-11 items-center px-2 text-[15px] font-semibold text-green-text" data-part="emp-voice-in-use">
                    {t("emp.page.voice.in_use")}
                  </span>
                ) : canEdit ? (
                  <button type="button" onClick={() => void use(v)} data-use={v.id} className={btnQuiet}>
                    {t("emp.page.voice.use", { name: v.name })}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-[15px] text-muted">{t("emp.page.voice.no_list")}</p>
      )}
      {chosen ? (
        <div role="status" data-part="emp-voice-saved" className="flex flex-wrap items-center gap-3 rounded-xl border border-green-text bg-green-bg p-3 font-medium text-green-text">
          <span>{t("vc.saved.for", { name: chosen, language })}</span>
          <button type="button" data-part="emp-voice-saved-play" onClick={() => player.playSpoken(`saved:${lang}`, () => actions.preview({ language: lang }))} className={playBtn}>
            <Play aria-hidden="true" className="size-4" />
            {t("vc.play_sample")}
          </button>
        </div>
      ) : null}
      {voiceError ? (
        <p role="alert" className="m-0 rounded-lg border border-red-text bg-red-bg p-3 font-medium text-red-text">
          {t(`emp.err.${voiceError}`)}
        </p>
      ) : null}

      <div>
        <label htmlFor={`emp-open-${lang}`} className={fieldLabel}>
          {t("emp.page.voice.opening", { language })}
        </label>
        <textarea id={`emp-open-${lang}`} rows={3} value={text} disabled={!canEdit} maxLength={OPENING_MAX} onChange={(e) => (setText(e.target.value), line.clear())} aria-describedby={`emp-open-${lang}-help`} className={`${fieldInput} py-2`} />
        <p id={`emp-open-${lang}-help`} className={fieldHelp}>
          {t("emp.page.voice.opening_help", { min: OPENING_MIN, max: OPENING_MAX })}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" disabled={trimmed.length < OPENING_MIN} onClick={() => player.playSpoken(`open:${lang}`, () => actions.preview({ language: lang, text: trimmed }))} aria-pressed={player.playing === `open:${lang}`} data-part="emp-open-play" className={playBtn}>
          <Play aria-hidden="true" className="size-4" />
          {t("emp.page.voice.play_line")}
        </button>
        {canEdit ? <SaveBar words={words} state={line} onSave={saveLine} disabled={!lineChanged} /> : null}
      </div>
    </Card>
  );
}
