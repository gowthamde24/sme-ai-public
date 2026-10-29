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
type Note = { language: PickerLang | "gender"; kind: "saved" | "error"; error?: string } | null;
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
  const [played, setPlayed] = React.useState<string | null>(null); // the voice whose sample was played last: its words are shown under it
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<Note>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => audio.current?.pause(), []);

  const play = (id: string) => {
    audio.current?.pause(); // one sample at a time
    if (playing === id) return setPlaying(null);
    setFailed(false);
    setPlayed(id);
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
    const out = await actions.choose(language, voice.isDefault ? null : voice.id);
    setBusy(null);
    if (out.ok) {
      setNote({ language, kind: "saved" });
      router.refresh();
    } else setNote({ language, kind: "error", error: out.error });
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
      <div className="mt-6 flex flex-col gap-6">
        {rows.map((row) => {
          const names = langNames[row.language as CallLang];
          const mine = row.voices.filter((v) => v.gender === gender);
          const inUse = mine.find((v) => v.id === row.choice) ?? mine.find((v) => v.isDefault) ?? null;
          const line = mine.find((v) => v.sampleText)?.sampleText ?? null;
          return (
            <div key={row.language} data-voice-lang={row.language}>
              <h3 className="text-base font-semibold" lang={row.language}>{names}</h3>
              {inUse ? <p data-part="speaking-in" className="text-sm text-muted">{t("vp.speaking", { language: names, voice: inUse.name })}</p> : null}
              {line ? <p lang={row.language} data-part="sample-line" className="mt-1 text-sm"><span className="font-semibold text-muted">{t("vp.line")} </span>{line}</p> : null}
              {mine.length === 0 ? <p className={help}>{t("vp.none")}</p> : null}
              <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mine.map((v) => {
                  const on = inUse?.id === v.id;
                  return (
                    <li key={v.id} data-voice={v.id} data-in-use={on ? "true" : undefined} className={`flex flex-col gap-3 rounded-2xl border p-3 ${on ? "border-brand-edge bg-brand-bg" : "border-edge bg-surface"}`}>
                      <div className="flex items-start gap-3">
                        {v.sampleUrl ? (
                          <button type="button" data-play={v.id} aria-pressed={playing === v.id} aria-label={playing === v.id ? t("vp.stop", { voice: v.name }) : t("vp.play", { voice: v.name })} onClick={() => play(v.id)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-edge bg-surface hover:bg-surface-2">
                            {playing === v.id ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
                          </button>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                            {v.name}
                            {v.recommended ? <span data-part="recommended" className="rounded-full bg-brand-bg px-2 py-0.5 text-xs font-semibold text-brand-text">{t("vp.recommended")}</span> : null}
                            {v.isDefault ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{t("vp.default")}</span> : null}
                          </p>
                          <p className="text-sm text-muted">{v.tags.map((x) => (PLAIN_TAGS.includes(x) ? t(`vp.tag.${x}` as "vp.tag.calm") : x)).join(" · ")}</p>
                        </div>
                      </div>
                      {played === v.id && v.sampleText ? (
                        <p lang={row.language} data-part="sample-text" className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                          <span className="block font-semibold text-muted">{t("vp.said")}</span>
                          {v.sampleText}
                        </p>
                      ) : null}
                      {on ? (
                        <p className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-text">
                          <span aria-hidden="true">✓</span> {t("vp.inuse")}
                        </p>
                      ) : (
                        <button type="button" disabled={!canEdit || busy !== null} onClick={() => choose(row.language, v)} className={`${secondary} w-full`}>
                          {busy === v.id ? t("vp.saving") : t("vp.use")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {note && note.language === row.language ? (
                note.kind === "saved" ? (
                  <p role="status" className={`${okLine} mt-2`}>{t("vp.saved", { language: names })}</p>
                ) : (
                  <p role="alert" className={`${errorLine} mt-2`}>{t(`vp.err.${note.error}` as "vp.err.down")}</p>
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

