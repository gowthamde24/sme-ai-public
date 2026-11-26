"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";

import type { Fail, PrefsResult, PreviewResult } from "@/app/app/tenants/[tenantId]/talk-prefs-actions";
import { callFor, exampleFor } from "@/lib/talk-prefs/example";
import { addressFor, type Field, type Patch, type Style, type TalkLang, type TalkPrefs, type TalkVoice } from "@/lib/talk-prefs/types";

import { Choose, MoreChoices, Sentence } from "../jobs/rules/parts";
import { SelectField } from "../settings/simple/fields";
import { alertBox, checkRow, fieldHelp, okBox } from "../ui";
import { makeT, type Words } from "../words";

export type TalkToYouActions = {
  load: (language: TalkLang) => Promise<PrefsResult>;
  save: (language: TalkLang, patch: Patch) => Promise<PrefsResult>;
  undo: (language: TalkLang, undoToken: string) => Promise<PrefsResult>;
  preview: (language: TalkLang, option: Patch) => Promise<PreviewResult>;
};

const chip = (on: boolean) => `min-h-11 rounded-md border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const hearBtn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-edge bg-surface text-ink hover:bg-surface-2";

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
 * "How it talks to you" (owner item G; made plain, owner 19 Nov 2026): the person's OWN way of being talked to, saved per user (not per business), never the customers' voice. ONE card: two sentences with the choice inside ("Talk to me in [Telugu] at a [Normal] speed." / "Be [Respectful] and call me [By name].")
 * and ONE live example line that follows them; the voice (female or male, three sounds, each with a play button) and the words are under More choices. One "Hear it" plays the sample of the chosen style (cached by the API; in the test mode only the words are shown, never a made-up voice). A choice saves at once and shows
 * "Saved" with Undo (15 minutes); the lists and the voices come from the API, the labels are ours. The language decides which voices and which "call me" options exist. Nothing about how it is saved changed.
 */
export function TalkToYou({ words, initial, languages, first, langNames, mock, actions, ownerFirst = null, plain = false }: { /** SETTINGS_OPEN (owner, 25 Nov 2026: no fill-in-the-blank sentences): four labelled fields with a hint each and ONE Save instead of the two sentences. */ plain?: boolean; words?: Words; /** The signed-in person's first name: the friendly sample greets them with it. */ ownerFirst?: string | null; initial: TalkPrefs; languages: readonly TalkLang[]; first: TalkLang; langNames: Record<string, string>; mock: boolean; actions: TalkToYouActions }) {
  const t = makeT(words);
  const [lang, setLang] = React.useState<TalkLang>(first);
  const [prefs, setPrefs] = React.useState<TalkPrefs>(initial);
  const [gender, setGender] = React.useState<"female" | "male">(initial.voice?.gender ?? "female");
  const [draft, setDraft] = React.useState<{ speed: string; style: string; address: string }>({ speed: initial.speed, style: initial.style, address: initial.address });
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
    setDraft({ speed: data.speed, style: data.style, address: data.address });
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
  const shownStyle = plain ? draft.style : prefs.style;
  const shownAddress = plain ? draft.address : prefs.address;
  const call = callFor(shownAddress as typeof prefs.address, ownerFirst, (name) => t(`vt.me.call.${shownAddress}` as "vt.me.call.garu", { name }));
  const example = exampleFor(lang, shownStyle as Style, call);
  const changed = (["speed", "style", "address"] as const).filter((f) => draft[f] !== prefs[f]);
  // ONE Save: the API takes one change at a time (one Undo each), so the changed fields go one after the other; Undo is offered only when exactly one changed
  const saveAll = () =>
    start(async () => {
      stop();
      setNote(null);
      let last: Extract<PrefsResult, { ok: true }> | null = null;
      for (const f of changed) {
        const out = await actions.save(lang, { [f]: draft[f] } as Patch).catch(() => null);
        if (!out?.ok) {
          if (last) adopt(last.data);
          setNote({ kind: "error", fail: out && !out.ok ? out.error : "down" });
          return;
        }
        last = out;
      }
      if (last) {
        adopt(last.data);
        setNote({ kind: "saved", token: changed.length === 1 ? last.data.undoToken : null, changed: last.data.changed });
      }
    });
  const chosen = (field: Exclude<Field, "voice">) => (value: string) => value !== prefs[field] && choose(field, value);
  const nameOf = (v: TalkVoice) => v.name;
  const hearPlaying = playing !== null;

  return (
    <section data-part="mya-talk-to-you" aria-labelledby="mya-ty-h" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 md:p-5">
      <div>
        <h2 id="mya-ty-h" className="m-0 font-display text-[18px] font-bold leading-tight md:text-xl">
          {t("vt.me.title")}
        </h2>
        <p className={fieldHelp} data-part="otp-peruser">
          {t("vt.me.help")}
        </p>
        {mock ? <p className={`${fieldHelp} rounded-lg bg-surface-2 px-3 py-2`}>{t("otp.mock")}</p> : null}
      </div>

      <div className="flex flex-col gap-1" data-part="vt-me-lines">
        {plain ? (
          <div className="flex flex-col gap-4" data-part="vt-me-fields">
            <SelectField label={t("vt.me.f.lang")} hint={t("vt.me.h.lang")} value={lang} options={languages.map((l) => ({ value: l, label: langNames[l] ?? l }))} disabled={busy} onChange={(l) => l !== lang && changeLang(l as TalkLang)} />
            <SelectField label={t("vt.me.f.speed")} hint={t("vt.me.h.speed")} value={draft.speed} options={o.speed.map((v) => ({ value: v, label: label("speed", v) }))} disabled={busy} onChange={(v) => setDraft((d) => ({ ...d, speed: v }))} />
            <SelectField label={t("vt.me.f.style")} hint={t("vt.me.h.style")} value={draft.style} options={o.style.map((v) => ({ value: v, label: label("style", v) }))} disabled={busy} onChange={(v) => setDraft((d) => ({ ...d, style: v }))} />
            <SelectField label={t("vt.me.f.address")} hint={t("vt.me.h.address")} value={draft.address} options={addresses.map((v) => ({ value: v, label: label("address", v) }))} disabled={busy} onChange={(v) => setDraft((d) => ({ ...d, address: v }))} />
          </div>
        ) : (
          <>
        <Sentence
          line="me-lang"
          template={t("vt.me.s1")}
          parts={{
            lang: (a) => <Choose aria={a} value={lang} options={languages} text={(l) => langNames[l] ?? l} disabled={busy} onChange={(l) => l !== lang && changeLang(l as TalkLang)} />,
            speed: (a) => <Choose aria={a} value={prefs.speed} options={o.speed} text={(v) => label("speed", v)} disabled={busy} onChange={chosen("speed")} />,
          }}
        />
        <Sentence
          line="me-style"
          template={t("vt.me.s2")}
          parts={{
            style: (a) => <Choose aria={a} value={prefs.style} options={o.style} text={(v) => label("style", v)} disabled={busy} onChange={chosen("style")} />,
            address: (a) => <Choose aria={a} value={prefs.address} options={addresses} text={(v) => label("address", v)} disabled={busy} onChange={chosen("address")} />,
          }}
        />
          </>
        )}
        <p data-part="vt-me-example" aria-live="polite" lang={lang} className="m-0 text-[15px] text-muted">
          {t("vt.ex.label")} <span className="font-medium text-ink">“{example}”</span>
        </p>
        <div className="mt-1">
          <button type="button" aria-pressed={hearPlaying} data-hear={`style:${shownStyle}`} onClick={() => hear("style", shownStyle)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-edge bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2">
            {hearPlaying ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            {t(hearPlaying ? "vt.stop" : "vt.hear")}
          </button>
        </div>
        {plain ? (
          <div data-part="vt-me-save" className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || changed.length === 0} onClick={saveAll} className="inline-flex min-h-11 items-center rounded-lg border border-brand-edge bg-brand px-5 text-[15px] font-semibold text-on-brand disabled:opacity-60">
              {t("vt.me.save")}
            </button>
            <p role="status" className="m-0 text-[14px] text-muted">
              {changed.length > 0 ? t("vt.me.unsaved") : ""}
            </p>
          </div>
        ) : null}
        {sample && !sample.sound ? (
          <p data-part="otp-sample" className="m-0 text-sm text-muted">
            {t("otp.nosound")}
          </p>
        ) : null}
      </div>

      <MoreChoices title={t("vt.more.t")} sub={t("vt.me.more.sub")}>
        <fieldset data-group="voice" className="m-0 min-w-0 border-0 p-0">
          <legend className="m-0 text-[16px] font-semibold">{t("otp.voice.t")}</legend>
          <div role="group" aria-label={t("otp.voice.t")} className="mt-1 flex flex-wrap gap-2">
            {(["female", "male"] as const).map((g) => (
              <button key={g} type="button" aria-pressed={gender === g} data-gender={g} onClick={() => setGender(g)} className={chip(gender === g)}>
                {t(`otp.gender.${g}` as "otp.gender.female")}
              </button>
            ))}
          </div>
          {voices.length === 0 ? (
            <p className="m-0 mt-2 text-sm text-muted" data-part="otp-novoice">
              {t("otp.voice.none")}
            </p>
          ) : (
            <div role="radiogroup" aria-label={t("otp.voice.t")} className="mt-1 flex flex-col">
              {voices.map((v) => (
                <div key={v.id} data-voice={v.id} data-selected={prefs.voice?.id === v.id ? "true" : "false"} className="flex min-h-14 items-center gap-2">
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 text-base">
                    <input type="radio" name="vt-me-voice" value={v.id} checked={prefs.voice?.id === v.id} disabled={busy} onChange={() => prefs.voice?.id !== v.id && choose("voice", v.id)} className="size-5 shrink-0 accent-brand-text" />
                    <span className="font-semibold">{nameOf(v)}</span>
                  </label>
                  {v.sample ? (
                    <button type="button" aria-pressed={playing === `voice:${v.id}`} aria-label={t("otp.hear.one", { what: nameOf(v) })} data-hear={`voice:${v.id}`} onClick={() => hear("voice", v.id)} className={hearBtn}>
                      {playing === `voice:${v.id}` ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </fieldset>
        <fieldset data-group="words" className="m-0 min-w-0 border-0 p-0">
          <legend className="m-0 text-[16px] font-semibold">{t("otp.words.t")}</legend>
          <div role="radiogroup" aria-label={t("otp.words.t")} className="mt-1 flex flex-col">
            {o.words.map((v) => (
              <label key={v} className={checkRow}>
                <input type="radio" name="vt-me-words" value={v} checked={prefs.words === v} disabled={busy} onChange={() => prefs.words !== v && choose("words", v)} className="size-5 shrink-0 accent-brand-text" />
                {label("words", v)}
              </label>
            ))}
          </div>
        </fieldset>
      </MoreChoices>

      {note?.kind === "saved" ? (
        <p role="status" className={`${okBox} m-0 flex flex-wrap items-center gap-3`} data-part="otp-saved">
          <span>{t("otp.saved")}</span>
          <span data-part="otp-live">{t("otp.saved.live")}</span>
          {note.token ? (
            <button type="button" disabled={busy} data-undo onClick={() => undo(note.token as string)} className="min-h-11 rounded-md border border-green-text bg-surface px-4 text-sm font-semibold text-green-text">
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
