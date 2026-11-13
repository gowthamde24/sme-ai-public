"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { CallLang } from "@/lib/assistant/types";
import type { Gender, PickerLang, PickerVoice } from "@/lib/voice-picker/types";

import { alertBox, fieldHelp, okBox } from "../ui";
import { makeT, type Words } from "../words";
import { inUseId, SOUNDS, voiceFor } from "./sounds";

export type ChooseVoice = (language: PickerLang, voiceId: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;

/**
 * Voice & tone, the first part: THREE voice cards named by their sound (Warm, Calm, Bright; no person's name anywhere) with "Hear greeting". The cards are made from the voice catalogue (the voice picker): for the language chosen above them, the voice of the workspace's gender
 * that carries the sound. "Hear greeting" plays that voice's recorded sample through this app's own route (`endpoint?id=`), "Use this sound" saves it as the voice of that language (the same choice as Settings > AI assistant > Voice). A sound no voice has in a language is said so, never drawn empty.
 * `mock` = the sounds are test tones.
 */
export function VoiceCards({ words, voices, choices, gender, languages, first, langNames, canEdit, endpoint, mock, choose }: { words?: Words; voices: readonly PickerVoice[]; choices: Partial<Record<PickerLang, string | null>>; gender: Gender; languages: readonly PickerLang[]; first: PickerLang; langNames: Record<CallLang, string>; canEdit: boolean; endpoint: string; mock: boolean; choose: ChooseVoice }) {
  const t = makeT(words);
  const router = useRouter();
  const [lang, setLang] = React.useState<PickerLang>(first);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Partial<Record<PickerLang, string>>>({});
  const [note, setNote] = React.useState<"saved" | "error" | "sample" | null>(null);
  const [busy, start] = React.useTransition();
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => audio.current?.pause(), []);
  const current = picked[lang] ?? inUseId(voices, choices, lang, gender);
  const play = (id: string) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    setNote(null);
    const a = new Audio(`${endpoint}?id=${encodeURIComponent(id)}`);
    audio.current = a;
    a.onended = () => setPlaying((p) => (p === id ? null : p));
    a.onerror = () => {
      setPlaying(null);
      setNote("sample");
    };
    setPlaying(id);
    a.play().catch(() => {
      setPlaying(null);
      setNote("sample");
    });
  };
  const use = (v: PickerVoice) =>
    start(async () => {
      audio.current?.pause();
      setPlaying(null);
      setNote(null);
      setPicked((p) => ({ ...p, [lang]: v.id }));
      const out = await choose(lang, v.isDefault ? null : v.id).catch(() => ({ ok: false as const, error: "down" }));
      if (out.ok) {
        setNote("saved");
        router.refresh();
      } else {
        setPicked((p) => ({ ...p, [lang]: undefined }));
        setNote("error");
      }
    });
  return (
    <section data-part="mya-voice-cards" aria-labelledby="mya-vc-h" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <div>
        <h2 id="mya-vc-h" className="font-display text-xl font-semibold">
          {t("mya.v.cards.t")}
        </h2>
        <p className={fieldHelp}>{t("mya.v.cards.sub")}</p>
        {mock ? <p className={`${fieldHelp} rounded-lg bg-surface-2 px-3 py-2`}>{t("vp.mock")}</p> : null}
      </div>
      <div role="group" aria-label={t("mya.v.lang")} className="flex flex-wrap gap-2">
        {languages.map((l) => (
          <button key={l} type="button" aria-pressed={l === lang} onClick={() => (setNote(null), setLang(l))} className={chip(l === lang)}>
            {langNames[l as CallLang]}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {SOUNDS.map((s) => {
          const v = voiceFor(voices, s, lang, gender, current);
          const on = v !== null && v.id === current;
          return (
            <article key={s} data-sound={s} data-selected={on ? "true" : "false"} className={`flex flex-col gap-2 rounded-xl border p-4 ${on ? "border-brand-edge bg-brand-bg" : "border-line bg-surface-2/40"}`}>
              <h3 className="font-display text-lg font-semibold">{t(`mya.v.${s}` as "mya.v.warm")}</h3>
              <p className="m-0 flex-1 text-sm text-muted">{t(`mya.v.${s}.d` as "mya.v.warm.d")}</p>
              {v ? (
                <div className="flex flex-wrap items-center gap-2">
                  {v.sampleUrl ? (
                    <button type="button" aria-pressed={playing === v.id} data-play={s} onClick={() => play(v.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-edge bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
                      {playing === v.id ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                      {t(playing === v.id ? "mya.v.stop" : "mya.v.hear")}
                    </button>
                  ) : null}
                  {on ? (
                    <span data-part="mya-inuse" className="inline-flex min-h-11 items-center text-sm font-semibold text-green-text">
                      ✓ {t("mya.v.selected")}
                    </span>
                  ) : canEdit ? (
                    <button type="button" disabled={busy} data-use={s} onClick={() => use(v)} className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-bold text-on-brand hover:brightness-95 disabled:opacity-60">
                      {t("mya.v.use")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="m-0 text-sm text-muted" data-part="mya-nosound">
                  {t("mya.v.none")}
                </p>
              )}
            </article>
          );
        })}
      </div>
      {note === "saved" ? (
        <p role="status" className={`${okBox} m-0`}>
          {t("mya.v.saved")}
        </p>
      ) : null}
      {note === "error" ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {t("mya.v.err")}
        </p>
      ) : null}
      {note === "sample" ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {t("vp.err.sample")}
        </p>
      ) : null}
      {!canEdit ? <p className={fieldHelp}>{t("vp.owneronly")}</p> : null}
    </section>
  );
}
