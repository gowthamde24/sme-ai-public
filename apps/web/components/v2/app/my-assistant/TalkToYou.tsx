"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";

import type { Fail, PrefsResult, PreviewResult } from "@/app/app/tenants/[tenantId]/talk-prefs-actions";
import { addressFor, type Field, type Patch, type TalkLang, type TalkPrefs, type TalkVoice } from "@/lib/talk-prefs/types";

import { alertBox, fieldHelp, okBox } from "../ui";
import { makeT, type Words } from "../words";

export type TalkToYouActions = {
  load: (language: TalkLang) => Promise<PrefsResult>;
  save: (language: TalkLang, patch: Patch) => Promise<PrefsResult>;
  undo: (language: TalkLang, undoToken: string) => Promise<PrefsResult>;
  preview: (language: TalkLang, option: Patch) => Promise<PreviewResult>;
};

const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const hearBtn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-edge bg-surface text-ink hover:bg-surface-2";

type Note = { kind: "saved"; token: string | null; changed: Field[] } | { kind: "undone" } | { kind: "error"; fail: Fail } | null;

function play(base64: string, contentType: string, onEnd: () => void): HTMLAudioElement | null {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    const a = new Audio(url);
    const done = () => {
      URL.revokeObjectURL(url);
      onEnd();
    };
    a.onended = done;
    a.onerror = done;
    void a.play().catch(done);
    return a;
  } catch {
    onEnd();
    return null;
  }
}

/**
 * "How it talks to you" (owner item G): the person's OWN way of being talked to, saved per user (not per business), never the customers' voice. Voice (three sounds, female or male), Style, Calls you, Words, Speed:
 * every option has a "Hear it" (a short sample in the chosen language, cached by the API; in the test mode only the words are shown, never a made-up voice). A tap saves at once and shows "Saved" with Undo
 * (15 minutes); the lists and the voices come from the API, the labels are ours. The language chips decide which voices and which "Calls you" options exist.
 */
export function TalkToYou({ words, initial, languages, first, langNames, mock, actions }: { words?: Words; initial: TalkPrefs; languages: readonly TalkLang[]; first: TalkLang; langNames: Record<string, string>; mock: boolean; actions: TalkToYouActions }) {
  const t = makeT(words);
  const [lang, setLang] = React.useState<TalkLang>(first);
  const [prefs, setPrefs] = React.useState<TalkPrefs>(initial);
  const [gender, setGender] = React.useState<"female" | "male">(initial.voice?.gender ?? "female");
  const [note, setNote] = React.useState<Note>(null);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [sample, setSample] = React.useState<{ text: string; sound: boolean } | null>(null);
  const [busy, start] = React.useTransition();
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => audio.current?.pause(), []);

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  const adopt = (data: TalkPrefs) => {
    setPrefs(data);
    if (data.voice) setGender(data.voice.gender);
  };
  const changeLang = (l: TalkLang) =>
    start(async () => {
      stop();
      setNote(null);
      setSample(null);
      setLang(l);
      const out = await actions.load(l).catch(() => null);
      if (out?.ok) adopt(out.data);
      else setNote({ kind: "error", fail: out && !out.ok ? out.error : "down" });
    });
  const choose = (field: Field, value: string) =>
    start(async () => {
      stop();
      setNote(null);
      const out = await actions.save(lang, { [field]: value } as Patch).catch(() => null);
      if (out?.ok) {
        adopt(out.data);
        setNote({ kind: "saved", token: out.data.undoToken, changed: out.data.changed });
      } else setNote({ kind: "error", fail: out && !out.ok ? out.error : "down" });
    });
  const undo = (token: string) =>
    start(async () => {
      stop();
      const out = await actions.undo(lang, token).catch(() => null);
      if (out?.ok) {
        adopt(out.data);
        setNote({ kind: "undone" });
      } else setNote({ kind: "error", fail: out && !out.ok ? out.error : "down" });
    });
  const hear = (field: Field, value: string) => {
    const key = `${field}:${value}`;
    if (playing === key) return stop();
    stop();
    setNote(null);
    setSample(null);
    setPlaying(key);
    void actions
      .preview(lang, { [field]: value } as Patch)
      .then((out) => {
        if (!out.ok) {
          setPlaying(null);
          setNote({ kind: "error", fail: out.error });
          return;
        }
        setSample({ text: out.data.text, sound: out.data.audio !== null });
        if (!out.data.audio) return setPlaying(null);
        audio.current = play(out.data.audio.base64, out.data.audio.contentType, () => setPlaying((p) => (p === key ? null : p)));
      })
      .catch(() => {
        setPlaying(null);
        setNote({ kind: "error", fail: "down" });
      });
  };

  const o = prefs.options;
  const voices = o.voices.filter((v) => v.gender === gender);
  const addresses = addressFor(lang, o.address);
  const langName = langNames[lang] ?? lang;
  const label = (field: Field, value: string): string => (field === "words" && value === "pure" ? t("otp.words.pure", { lang: langName }) : t(`otp.${field}.${value}` as "otp.style.friendly"));
  const hearButton = (field: Field, value: string, text: string) => (
    <button type="button" aria-pressed={playing === `${field}:${value}`} aria-label={t("otp.hear.one", { what: text })} data-hear={`${field}:${value}`} onClick={() => hear(field, value)} className={hearBtn}>
      {playing === `${field}:${value}` ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
    </button>
  );
  const group = (field: Exclude<Field, "voice">, values: readonly string[], current: string) => (
    <div key={field} data-group={field} className="flex flex-col gap-2">
      <h3 className="m-0 font-display text-lg font-semibold">{t(`otp.${field}.t` as "otp.style.t")}</h3>
      <p className="m-0 text-sm text-muted">{t(`otp.${field}.d` as "otp.style.d")}</p>
      <div role="radiogroup" aria-label={t(`otp.${field}.t` as "otp.style.t")} className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1">
            <button type="button" role="radio" aria-checked={current === v} disabled={busy} data-option={`${field}:${v}`} onClick={() => current !== v && choose(field, v)} className={chip(current === v)}>
              {label(field, v)}
            </button>
            {hearButton(field, v, label(field, v))}
          </span>
        ))}
      </div>
    </div>
  );
  const nameOf = (v: TalkVoice) => (v.sound ? t(`mya.v.${v.sound}` as "mya.v.warm") : v.name);

  return (
    <section data-part="mya-talk-to-you" aria-labelledby="mya-ty-h" className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <div>
        <h2 id="mya-ty-h" className="font-display text-xl font-semibold">
          {t("otp.t")}
        </h2>
        <p className={fieldHelp}>{t("otp.sub")}</p>
        <p className={fieldHelp} data-part="otp-peruser">
          {t("otp.peruser")}
        </p>
        {mock ? <p className={`${fieldHelp} rounded-lg bg-surface-2 px-3 py-2`}>{t("otp.mock")}</p> : null}
        {prefs.isDefault ? (
          <p className={fieldHelp} data-part="otp-defaults">
            {t("otp.defaults")}
          </p>
        ) : null}
      </div>
      <div role="group" aria-label={t("otp.lang")} className="flex flex-wrap gap-2">
        {languages.map((l) => (
          <button key={l} type="button" aria-pressed={l === lang} disabled={busy} data-lang={l} onClick={() => l !== lang && changeLang(l)} className={chip(l === lang)}>
            {langNames[l] ?? l}
          </button>
        ))}
      </div>

      <div data-group="voice" className="flex flex-col gap-2">
        <h3 className="m-0 font-display text-lg font-semibold">{t("otp.voice.t")}</h3>
        <p className="m-0 text-sm text-muted">{t("otp.voice.d")}</p>
        <div role="group" aria-label={t("otp.voice.t")} className="flex flex-wrap gap-2">
          {(["female", "male"] as const).map((g) => (
            <button key={g} type="button" aria-pressed={gender === g} data-gender={g} onClick={() => setGender(g)} className={chip(gender === g)}>
              {t(`otp.gender.${g}` as "otp.gender.female")}
            </button>
          ))}
        </div>
        {voices.length === 0 ? (
          <p className="m-0 text-sm text-muted" data-part="otp-novoice">
            {t("otp.voice.none")}
          </p>
        ) : (
          <div role="radiogroup" aria-label={t("otp.voice.t")} className="grid gap-2 md:grid-cols-3">
            {voices.map((v) => (
              <div key={v.id} data-voice={v.id} data-selected={prefs.voice?.id === v.id ? "true" : "false"} className={`flex items-center justify-between gap-2 rounded-xl border p-3 ${prefs.voice?.id === v.id ? "border-brand-edge bg-brand-bg" : "border-line bg-surface-2/40"}`}>
                <button type="button" role="radio" aria-checked={prefs.voice?.id === v.id} disabled={busy} onClick={() => prefs.voice?.id !== v.id && choose("voice", v.id)} className="min-h-11 flex-1 text-left text-base font-semibold">
                  {nameOf(v)}
                  {prefs.voice?.id === v.id ? <span className="ml-2 text-sm text-green-text">✓ {t("mya.v.selected")}</span> : null}
                </button>
                {v.sample ? hearButton("voice", v.id, nameOf(v)) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {group("style", o.style, prefs.style)}
      {group("address", addresses, prefs.address)}
      {group("words", o.words, prefs.words)}
      {group("speed", o.speed, prefs.speed)}

      {sample ? (
        <p data-part="otp-sample" className="m-0 rounded-lg bg-surface-2 px-3 py-2 text-base">
          <span className="text-sm text-muted">{t("otp.sample")} </span>
          {sample.text}
          {!sample.sound ? <span className="block text-sm text-muted">{t("otp.nosound")}</span> : null}
        </p>
      ) : null}
      {note?.kind === "saved" ? (
        <p role="status" className={`${okBox} m-0 flex flex-wrap items-center gap-3`} data-part="otp-saved">
          <span>{t("otp.saved")}</span>
          {note.token ? (
            <button type="button" disabled={busy} data-undo onClick={() => undo(note.token as string)} className="min-h-11 rounded-full border border-green-text bg-surface px-4 text-sm font-semibold text-green-text">
              {t("otp.undo")}
            </button>
          ) : null}
        </p>
      ) : null}
      {note?.kind === "undone" ? (
        <p role="status" className={`${okBox} m-0`} data-part="otp-undone">
          {t("otp.undone")}
        </p>
      ) : null}
      {note?.kind === "error" ? (
        <p role="alert" className={`${alertBox} m-0`} data-part="otp-error">
          {t(`otp.err.${note.fail}` as "otp.err.down")}
        </p>
      ) : null}
    </section>
  );
}

