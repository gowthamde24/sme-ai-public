"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { CallLang } from "@/lib/assistant/types";
import { GENDERS, type Gender, type PickerLang, type PickerVoice } from "@/lib/voice-picker/types";

import { makeT, type Words } from "../words";
import { errorLine, help, okLine, secondary } from "../visits/styles";

export type VoiceRow = { language: PickerLang; voices: readonly PickerVoice[]; choice: string | null };
export type VoicePickerActions = { choose: (language: PickerLang, voiceId: string | null) => Promise<{ ok: true } | { ok: false; error: string }>; setGender: (gender: Gender) => Promise<{ ok: true } | { ok: false; error: string }> };
type Note = { language: PickerLang | "gender"; kind: "saved" | "error"; error?: string; voice?: string } | null;
const PLAIN_TAGS = ["calm", "warm", "deep", "bright", "young", "mature", "energetic"];

/**
 * Settings > AI assistant > Voice (owner decision 28 Oct): one block per language the business talks in, with a card for each approved voice: its name, a plain label, female or male, a play button for its recorded sample and "Use this voice". The voice
 * in use is ticked; the default carries a "Default" badge and is the voice until another is chosen (choosing the default again goes back to it). Play and stop are ONE button, and only one sample plays at a time. The sample comes from this app's own
 * route (`endpoint?id=`); nothing is asked of the voice service on a click. Only the Owner or an Admin can change it (`canEdit`); `mock` says the sounds are test tones.
 */
export function VoicePicker({ words, gender, rows, langNames, canEdit, endpoint, mock, actions }: { words?: Words; gender: Gender; rows: readonly VoiceRow[]; langNames: Record<CallLang, string>; canEdit: boolean; endpoint: string; mock: boolean; actions: VoicePickerActions }) {
  const t = makeT(words);
  const router = useRouter();
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<Note>(null);
  const [picked, setPicked] = React.useState<Partial<Record<PickerLang, string>>>({}); // the choice just made, shown at once while it is saved
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => audio.current?.pause(), []);

  const play = (id: string) => {
    audio.current?.pause(); // one sample at a time
    if (playing === id) return setPlaying(null);
    setFailed(false);
    const a = new Audio(`${endpoint}?id=${encodeURIComponent(id)}`);
    audio.current = a;
    a.onended = () => setPlaying((p) => (p === id ? null : p));
    a.onerror = () => {
      setPlaying(null);
      setFailed(true);
    };
    setPlaying(id);
    a.play().catch(() => {
      setPlaying(null);
      setFailed(true);
    });
  };
  const pickGender = async (g: Gender) => {
    if (g === gender || busy !== null) return;
    audio.current?.pause();
    setPlaying(null);
    setPicked({});
    setBusy(`gender-${g}`);
    setNote(null);
    const out = await actions.setGender(g);
    setBusy(null);
    if (out.ok) {
      setNote({ language: "gender", kind: "saved" });
      router.refresh();
    } else setNote({ language: "gender", kind: "error", error: out.error });
  };
  const choose = async (language: PickerLang, voice: PickerVoice) => {
    setBusy(voice.id);
    setNote(null);
    setPicked((x) => ({ ...x, [language]: voice.id }));
    const out = await actions.choose(language, voice.isDefault ? null : voice.id);
    setBusy(null);
    if (out.ok) {
      setNote({ language, kind: "saved", voice: voice.name });
      router.refresh();
    } else {
      setPicked((x) => ({ ...x, [language]: undefined }));
      setNote({ language, kind: "error", error: out.error });
    }
  };

  return (
    <section data-part="voice-picker" aria-labelledby="vp-h" className="rounded-[20px] border border-line bg-surface p-4 md:p-5">
      <h2 id="vp-h" className="font-display text-xl font-semibold leading-tight">
        {t("vp.title")}
      </h2>
      <p className={help}>{t("vp.sub")}</p>
      {mock ? <p role="note" className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{t("vp.mock")}</p> : null}
      {!canEdit ? <p className={help}>{t("vp.owneronly")}</p> : null}
      {failed ? <p role="alert" className="mt-2 text-sm font-medium text-red-text">{t("vp.err.sample")}</p> : null}
      <div data-part="voice-gender" role="radiogroup" aria-label={t("vp.gender.t")} className="mt-4 flex flex-col gap-2">
        <p className="text-base font-semibold">{t("vp.gender.t")}</p>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <button key={g} type="button" role="radio" data-gender={g} aria-checked={gender === g} disabled={!canEdit || busy !== null} onClick={() => void pickGender(g)} className={`min-h-11 rounded-full border px-5 text-base font-semibold ${gender === g ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-ink hover:bg-surface-2"} disabled:opacity-70`}>
              {t(`vp.gender.${g}` as "vp.gender.female")}
            </button>
          ))}
        </div>
        <p className={help}>{t("vp.gender.d")}</p>
        {note && note.language === "gender" ? (note.kind === "saved" ? <p role="status" className={okLine}>{t("vp.gender.saved", { gender: t(`vp.gender.${gender}` as "vp.gender.female") })}</p> : <p role="alert" className={errorLine}>{t(`vp.err.${note.error}` as "vp.err.down")}</p>) : null}
      </div>
      <div className="mt-6 flex flex-col gap-5">
        {rows.map((row) => {
          const names = langNames[row.language as CallLang];
          // the voices of the workspace's gender, the recommended ones first (the catalogue's order inside each group)
          const mine = row.voices.filter((v) => v.gender === gender).sort((x, y) => Number(y.recommended) - Number(x.recommended));
          const inUse = mine.find((v) => v.id === row.choice) ?? mine.find((v) => v.isDefault) ?? null;
          const shown = mine.find((v) => v.id === picked[row.language]) ?? inUse;
          const id = `vp-${row.language}`;
          return (
            <div key={row.language} data-voice-lang={row.language} className="flex flex-col gap-2">
              <label htmlFor={id} className="text-base font-semibold" lang={row.language}>{names}</label>
              {mine.length === 0 ? <p className={help}>{t("vp.none")}</p> : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select id={id} data-voice-select={row.language} value={shown?.id ?? ""} disabled={!canEdit || busy !== null} onChange={(e) => { const v = mine.find((x) => x.id === e.target.value); if (!v) return; audio.current?.pause(); setPlaying(null); void choose(row.language, v); }} className="min-h-12 w-full min-w-0 rounded-xl border border-edge bg-surface px-3 text-base text-ink disabled:opacity-70 sm:flex-1">
                    {mine.map((v) => (
                      <option key={v.id} value={v.id}>{`${v.name} — ${v.tags.map((x) => (PLAIN_TAGS.includes(x) ? t(`vp.tag.${x}` as "vp.tag.calm") : x)).join(", ")}${v.recommended ? ` · ${t("vp.recommended")}` : ""}`}</option>
                    ))}
                  </select>
                  {shown && shown.sampleUrl ? (
                    <button type="button" data-play={shown.id} aria-pressed={playing === shown.id} aria-label={playing === shown.id ? t("vp.stop", { voice: shown.name }) : t("vp.play", { voice: shown.name })} onClick={() => play(shown.id)} className={`${secondary} w-full sm:w-auto sm:min-w-28`}>
                      {playing === shown.id ? <><Pause className="mr-1 inline size-4" aria-hidden="true" />{t("vp.hear.stop")}</> : <><Play className="mr-1 inline size-4" aria-hidden="true" />{t("vp.hear")}</>}
                    </button>
                  ) : null}
                </div>
              )}
              {playing !== null && shown && playing === shown.id && shown.sampleText ? (
                <p lang={row.language} data-part="sample-text" className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  <span className="block font-semibold text-muted">{t("vp.said")}</span>
                  {shown.sampleText}
                </p>
              ) : null}
              {note && note.language === row.language ? (
                note.kind === "saved" ? (
                  <p role="status" data-part="toast" className={okLine}>{t("vp.toast", { language: names, voice: note.voice ?? "" })}</p>
                ) : (
                  <p role="alert" className={errorLine}>{t(`vp.err.${note.error}` as "vp.err.down")}</p>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      <p className={help}>{t("vp.sample.note")}</p>
    </section>
  );
}

