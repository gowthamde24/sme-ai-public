"use client";

import { Check, Loader2, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { CallLang } from "@/lib/assistant/types";
import type { Preview } from "@/lib/opening-line/types";
import { BASE_TONE, type HowSpeaks, type SpeakTone } from "@/lib/talk-training/speaks";
import { SOUNDS_LIKE, type Gender, type PickerLang, type PickerVoice } from "@/lib/voice-picker/types";

import type { SpeaksPanel } from "../assistant/HowAssistantSpeaks";
import { Tick } from "../ds/Tick";
import { alertBox, btnMain, btnQuiet, fieldHelp, okBox } from "../ui";
import { makeT, type Words } from "../words";

export type ChooseVoice = (language: PickerLang, voiceId: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
/** The live "Hear it": a listed voice speaks the saved greeting, in the tone on the screen (C1: `POST /voices/preview {language, voice_id, tone}`). */
export type HearVoice = (language: PickerLang, voiceId: string, tone: SpeakTone) => Promise<{ ok: true; preview: Preview } | { ok: false; error: string }>;
/** The words of the preview in one tone and language (C1: `GET /voice-preview/text`), or null = keep our own sentence. */
export type ToneExample = (language: PickerLang, tone: SpeakTone) => Promise<string | null>;

export type VoiceCardPicker = { voices: readonly PickerVoice[]; choices: Partial<Record<PickerLang, string | null>>; active: Partial<Record<PickerLang, string | null>>; gender: Gender; fake: boolean };
export type VoiceCardProps = {
  words?: Words;
  /** the app's language: the background choices are named in it */
  uiLang: string;
  /** the voices of every language (C1: `GET /ai-assistant/voices`); null = not there */
  picker: VoiceCardPicker | null;
  /** only the languages that have a voice; the first one opens */
  languages: readonly PickerLang[];
  first: PickerLang;
  langNames: Record<CallLang, string>;
  /** this workspace's `voice-pick` route: the recorded sample of one voice */
  endpoint: string;
  choose: ChooseVoice;
  hear: HearVoice | null;
  /** tone, background and the AI switch (`GET/PUT /how-assistant-speaks`); null = not there */
  speaks: SpeaksPanel | null;
  /** our own example sentence for each language and tone (the words file); the API's text replaces it where it has one */
  examples: Readonly<Record<string, Partial<Record<SpeakTone, string>>>>;
  /** a real two-sided sample call per language and tone (customer line, assistant line, ...): shown instead of the one-sided example when there is one */
  conversations?: Readonly<Record<string, Partial<Record<SpeakTone, readonly string[]>>>>;
  /** the OPEN layout (MY_ASSISTANT_OPEN): the voices are a plain row list (recommended first, the rest under See all), the sample call a hairline block */
  open?: boolean;
  /** the languages whose example sentences are drafts nobody native has read */
  draftLangs: readonly string[];
  toneExample: ToneExample | null;
  canEdit: boolean;
  securityHref: string;
  /** the existing "Place a test call" page; null = test calls are not on here */
  testCallHref: string | null;
};

const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const h3 = "m-0 text-[16px] font-semibold text-ink";
const radio = "size-5 shrink-0 accent-brand-text";
const playBtn = "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-edge bg-surface px-4 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50";
type Note = "saved" | "error" | "sample" | "live" | "rate" | "silent" | "unknown" | "unavailable" | "other" | null;

/**
 * THE VOICE CARD, "Your assistant's voice" (owner, 20 Nov 2026: one simple card): for each language a row of NAMED voices (Ramya, Kavitha ...) with a play button and a round radio; how it talks as three plain choices (Friendly, Respectful, Short and quick) with ONE example sentence
 * that follows the tone and the language; the background sound; the small switch "Say 'AI assistant' when greeting"; and the test call to the owner's phone. Every choice is saved the moment it is made (the voice with `PUT /voices`, the rest with `PUT /how-assistant-speaks`) and put back, with
 * the reason, if the API says no. One sound at a time: starting one stops the other. Nothing plays by itself. A recorded sample plays through our own route; a voice with no recording (`sample_ready: false`) is heard live in its own voice and the tone on the screen (`voice_id` and `tone` go with the preview; the sound must name that voice, else it is not played as this one).
 * No Warm/Calm/Bright, no Region, no speed.
 */
export function VoiceCard({ words, uiLang, picker, languages, first, langNames, endpoint, choose, hear, speaks, examples, conversations, open = false, draftLangs, toneExample, canEdit, securityHref, testCallHref }: VoiceCardProps) {
  const t = makeT(words);
  const router = useRouter();
  const [lang, setLang] = React.useState<PickerLang>(languages.includes(first) ? first : (languages[0] ?? first));
  // what was picked here, kept only for the voices document it was picked on: the page read again after a choice brings a new one, and what the API says replaces it
  const [pickedOn, setPickedOn] = React.useState<{ on: unknown; ids: Partial<Record<PickerLang, string>> }>({ on: null, ids: {} });
  const picked = pickedOn.on === picker ? pickedOn.ids : {};
  const setPicked = (f: (p: Partial<Record<PickerLang, string>>) => Partial<Record<PickerLang, string>>) => setPickedOn((c) => ({ on: picker, ids: f(c.on === picker ? c.ids : {}) }));
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<Note>(null);
  const [busy, startVoice] = React.useTransition();
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const turn = React.useRef(0); // which press the sound that is coming back belongs to
  const stop = React.useCallback(() => {
    turn.current += 1;
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
    setLoading(null);
  }, []);
  React.useEffect(() => stop, [stop]);

  // how it talks, the background, the AI switch: one answer of the API, kept as it comes back
  const [state, setState] = React.useState<HowSpeaks | null>(speaks?.initial ?? null);
  const [speaksNote, setSpeaksNote] = React.useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [saving, startSpeaks] = React.useTransition();
  const [sounds, setSounds] = React.useState<(typeof SOUNDS_LIKE)[number] | null>(null);
  const [apiText, setApiText] = React.useState<Record<string, string>>({});

  // ALL the listed voices of the language, women first, then men (C1: the short list has both; choosing one of the other gender switches the assistant's voice type with the same call)
  // one row per voice name (a narration variant shares its name with the plain voice): keep the one in use, else the first
  const oneEach = <V extends { id: string; name: string }>(list: readonly V[]): V[] =>
    list.filter((v) => {
      const same = list.filter((x) => x.name === v.name);
      return (same.find((x) => x.id === picker?.active[lang]) ?? same[0]) === v;
    });
  const mine = picker ? [...oneEach(picker.voices.filter((v) => v.language === lang && v.gender === "female")), ...oneEach(picker.voices.filter((v) => v.language === lang && v.gender === "male"))] : [];
  const own = picker ? mine.filter((v) => v.gender === picker.gender) : [];
  const inUse = picker ? (picked[lang] ?? (picker.active[lang] && mine.some((v) => v.id === picker.active[lang]) ? picker.active[lang] : null) ?? own.find((v) => v.id === picker.choices[lang])?.id ?? own.find((v) => v.isDefault)?.id ?? null) : null;
  const edit = canEdit && !busy;

  const play = (v: PickerVoice) => {
    if (playing === v.id || loading === v.id) return stop();
    stop();
    setNote(null);
    const mark = turn.current;
    const fail = (kind: Note) => {
      if (turn.current !== mark) return;
      setPlaying(null);
      setLoading(null);
      setNote(kind);
    };
    const start = (src: string, done?: () => void) => {
      const a = new Audio(src);
      audio.current = a;
      a.onended = () => {
        done?.();
        if (turn.current === mark) setPlaying(null);
      };
      a.onerror = () => {
        done?.();
        fail("sample");
      };
      setLoading(null);
      setPlaying(v.id);
      a.play().catch(() => (done?.(), fail("sample")));
    };
    if (v.sampleReady && v.sampleUrl) return start(`${endpoint}?id=${encodeURIComponent(v.id)}`);
    if (!hear) return fail("live");
    setLoading(v.id);
    void hear(lang, v.id, tone)
      .catch(() => ({ ok: false as const, error: "down" }))
      .then((out) => {
        if (turn.current !== mark) return;
        if (!out.ok) return fail(out.error === "rate" ? "rate" : out.error === "unknown_voice" ? "unknown" : "other");
        const sound = out.preview.audio;
        if (!sound) return fail("silent");
        if (out.preview.voiceId && out.preview.voiceId !== v.id) return fail("live"); // the API spoke another voice: never present it as this one
        // a blob: address, not a data: one: the page's media rule allows only this app's own address and blob: (lib/security/csp.ts)
        const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(sound.base64), (c) => c.charCodeAt(0))], { type: sound.mime }));
        start(url, () => URL.revokeObjectURL(url));
      });
  };

  const use = (v: PickerVoice) => {
    const language = lang;
    startVoice(async () => {
      stop();
      setNote(null);
      const before = picked[language];
      setPicked((p) => ({ ...p, [language]: v.id }));
      const out = await choose(language, v.id).catch(() => ({ ok: false as const, error: "down" }));
      if (out.ok) {
        setNote("saved");
        router.refresh();
      } else {
        setPicked((p) => ({ ...p, [language]: before }));
        setNote(out.error === "invalid" ? "unavailable" : "error"); // 422: the API does not take that voice (yet): the choice stays where it was, nothing is made up
      }
    });
  };

  const [offAsk, setOffAsk] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);
  const change = (c: Parameters<SpeaksPanel["save"]>[0]) => {
    if (!speaks || saving) return;
    startSpeaks(async () => {
      setSpeaksNote(null);
      const out = await speaks.save(c).catch(() => ({ ok: false as const, error: "down" }));
      if (out.ok) {
        setState(out.data);
        setSpeaksNote({ ok: true });
        router.refresh();
      } else setSpeaksNote({ ok: false, error: out.error });
    });
  };

  // the example under the tones: our own sentence at once, the API's own words for this voice language and tone when they arrive
  const tone: SpeakTone = state?.tone.value ?? "friendly";
  const exLang = examples[lang] ? lang : "en";
  const exKey = `${lang}:${tone}`;
  React.useEffect(() => {
    if (!toneExample || !state || apiText[exKey] !== undefined) return;
    let live = true;
    void toneExample(lang, tone)
      .catch(() => null)
      .then((text) => {
        if (live && text) setApiText((m) => ({ ...m, [exKey]: text }));
      });
    return () => {
      live = false;
    };
  }, [toneExample, state, apiText, exKey, lang, tone]);
  const example = apiText[exKey] ?? examples[exLang]?.[BASE_TONE[tone]] ?? "";
  // the styles: the API's list (7, with their words in the language of the page; drafts until reviewed), or the three the web has always known
  const toneList: { id: SpeakTone; label: string; hint: string }[] = state?.tone.options?.length
    ? state.tone.options.map((o) => ({ id: o.id, label: o.label[uiLang] ?? o.label.en ?? o.id, hint: o.hint[uiLang] ?? o.hint.en ?? "" }))
    : (["friendly", "respectful", "quick"] as const).map((x) => ({ id: x, label: t(`vc.tone.${x}`), hint: t(`vc.tone.${x}.d`) }));
  const turns = conversations?.[conversations[lang] ? lang : "en"]?.[BASE_TONE[tone]] ?? null;
  const isDraft = apiText[exKey] === undefined && draftLangs.includes(exLang);

  const bg = state?.background ?? null;
  const sayAi = state?.sayAi ?? null;
  const optionName = (id: string): string => bg?.options.find((o) => o.id === id)?.label[uiLang] ?? bg?.options.find((o) => o.id === id)?.label.en ?? id;
  const speaksErr = speaksNote && !speaksNote.ok ? (t(`sp.err.${speaksNote.error}`) !== `sp.err.${speaksNote.error}` ? t(`sp.err.${speaksNote.error}`) : t("sp.err.rejected")) : null;
  const noteText: Record<Exclude<Note, null | "saved">, string> = { error: t("vc.err.save"), sample: t("vp.err.sample"), live: t("vc.err.live"), rate: t("vc.err.rate"), silent: t("vt.hear.none"), unknown: t("vc.err.unknown"), unavailable: t("vc.err.unavailable"), other: t("vc.err.other") };
  if (!picker && !speaks) return null;

  // the open layout's voice rows: avatar initial, the name (bold when it is the one in use), one grey line, Play, then the round radio at the far right; hairlines between rows, no box, no tint
  const openRow = (v: (typeof mine)[number]) => {
    const on = v.id === inUse;
    const here = playing === v.id;
    const waiting = loading === v.id;
    const later = !(v.sampleReady && v.sampleUrl) && !hear;
    return (
      <div key={v.id} data-voice={v.id} data-selected={on ? "true" : "false"} className="flex min-h-14 items-center gap-3 border-t border-line py-2">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-[15px] font-semibold text-muted">
          {v.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[16px] text-ink ${on ? "font-bold" : "font-semibold"}`}>{v.name}</span>
          <span className="block text-sm text-muted">
            {t(v.gender === "male" ? "vc.man" : "vc.woman")}
            {v.recommended ? ` · ${t("vp.recommended")}` : ""}
            {on ? ` · ${t("mya.v.selected")}` : ""}
            {later ? ` · ${t("vc.later")}` : ""}
          </span>
        </span>
        <button type="button" data-play={v.id} disabled={later} aria-pressed={here} aria-label={t(here ? "vc.stop.aria" : "vc.play.aria", { name: v.name })} onClick={() => play(v)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[15px] font-semibold text-muted hover:text-ink disabled:opacity-50">
          {waiting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : here ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
          {t(here ? "vt.stop" : "vt.play")}
        </button>
        <input type="radio" name="vc-voice" value={v.id} checked={on} disabled={!edit} aria-label={v.name} onChange={() => !on && use(v)} className={`${radio} shrink-0 !accent-[var(--v2-ink)]`} />
      </div>
    );
  };
  // 'Sounds like' (C1's voice categories): a row of chips, only the categories this language has voices for; none chosen = Recommended first
  const categories = SOUNDS_LIKE.filter((c) => mine.some((v) => v.soundsLike === c));
  const chosenSounds = sounds !== null && categories.includes(sounds) ? sounds : null;
  // recommended first (and the one in use, whatever it is); everything else behind "See all voices (N)"; a language with no recommended voice shows them all
  const shownFirst = chosenSounds ? mine.filter((v) => v.soundsLike === chosenSounds) : mine.some((v) => v.recommended) ? mine.filter((v) => v.recommended || v.id === inUse) : mine;
  const hiddenRest = chosenSounds ? [] : mine.filter((v) => !shownFirst.includes(v));
  return (
    <section data-part="mya-voice-card" aria-labelledby="vc-h" className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <div>
        <h2 id="vc-h" className="m-0 font-display text-[18px] font-bold leading-tight md:text-xl">
          {t("vc.title")}
        </h2>
        <p className={fieldHelp}>{t("vc.sub")}</p>
        {speaks?.demo || picker?.fake ? (
          <p className={`${fieldHelp} rounded-lg bg-surface-2 px-3 py-2`} data-part="sp-notsaved">
            {[speaks?.demo ? t("sp.notsaved") : null, picker?.fake ? t("vp.mock") : null].filter(Boolean).join(" ")}
          </p>
        ) : null}
        {canEdit ? null : <p className={fieldHelp}>{t("vp.owneronly")}</p>}
      </div>

      {picker ? (
        <>
          {languages.length > 1 ? (
            <div role="group" aria-label={t("vt.lang")} className="flex flex-wrap gap-2" data-part="vc-lang">
              {languages.map((l) => (
                <button key={l} type="button" aria-pressed={l === lang} onClick={() => (stop(), setNote(null), setLang(l))} className={chip(l === lang)}>
                  {langNames[l as CallLang]}
                </button>
              ))}
            </div>
          ) : null}

          <fieldset className="m-0 min-w-0 border-0 p-0" data-part="vc-voices">
            <legend className={`${h3} mb-2`}>{t("vt.voice")}</legend>
            {mine.length === 0 ? (
              <p className="m-0 text-[15px] text-muted" data-part="vc-novoice">
                {t("vp.none")}
              </p>
            ) : (
              open ? (
                <div className="flex flex-col" data-part="vc-voice-open">
                  {categories.length > 0 ? (
                    <div role="group" aria-label={t("vc.sounds.t")} data-part="vc-sounds" className="mb-2 flex flex-wrap gap-2">
                      {[null, ...categories].map((c) => (
                        <button key={c ?? "rec"} type="button" aria-pressed={chosenSounds === c} onClick={() => setSounds(c)} className={`min-h-9 rounded-full border px-3.5 text-sm font-semibold ${chosenSounds === c ? "border-ink bg-ink text-bg" : "border-line text-muted"}`}>
                          {c === null ? t("vp.recommended") : t(`vc.sounds.${c}`)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                <div role="radiogroup" aria-label={t("vt.voice")} className="flex flex-col" data-part="vc-voice-rows">
                  {([["female", "vc.women"], ["male", "vc.men"]] as const).map(([g, key]) => {
                    const list = shownFirst.filter((v) => v.gender === g);
                    return list.length === 0 ? null : (
                      <div key={g} data-group={g} className="flex flex-col pb-2">
                        {mine.some((v) => v.gender !== g) ? <p className="m-0 pb-1 pt-2 text-sm font-semibold text-muted">{t(key)}</p> : null}
                        {list.map(openRow)}
                      </div>
                    );
                  })}
                  {hiddenRest.length > 0 ? (
                    <details data-part="vc-see-all" className="border-t border-line">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center py-2 text-[15px] font-semibold text-ink">{t("vc.see_all", { n: mine.length })}</summary>
                      <div className="flex flex-col">{hiddenRest.map(openRow)}</div>
                    </details>
                  ) : null}
                </div>
                </div>
              ) : (
              <div role="radiogroup" aria-label={t("vt.voice")} className="flex flex-col gap-3">
                {([["female", "vc.women"], ["male", "vc.men"]] as const).map(([g, key]) => {
                  const list = mine.filter((v) => v.gender === g);
                  if (list.length === 0) return null;
                  return (
                    <div key={g} data-group={g} className="flex flex-col gap-2">
                      {mine.some((v) => v.gender !== g) ? <p className="m-0 text-sm font-semibold text-muted">{t(key)}</p> : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {list.map((v) => {
                  const on = v.id === inUse;
                  const here = playing === v.id;
                  const waiting = loading === v.id;
                  const later = !(v.sampleReady && v.sampleUrl) && !hear; // (no recording and no live preview here: nothing to play)
                  return (
                    <div key={v.id} data-voice={v.id} data-selected={on ? "true" : "false"} className={`flex min-h-16 items-center gap-2 rounded-xl border p-2 pl-3 ${on ? "border-brand-edge bg-surface-2" : "border-line bg-surface"}`}>
                      <label className={`flex min-h-11 min-w-0 flex-1 items-start gap-3 py-1 ${edit ? "cursor-pointer" : "opacity-80"}`}>
                        <input type="radio" name="vc-voice" value={v.id} checked={on} disabled={!edit} onChange={() => !on && use(v)} className={`${radio} mt-1`} />
                        <span className="min-w-0">
                          <span className="block text-[16px] font-semibold text-ink">{v.name}</span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
                            {t(v.gender === "male" ? "vc.man" : "vc.woman")}
                            {v.recommended ? <b className="font-semibold text-brand-text">{t("vp.recommended")}</b> : null}
                            {on ? (
                              <span data-part="mya-inuse" className="inline-flex items-center gap-1 font-semibold text-green-text">
                                <Check className="size-3.5" aria-hidden="true" />
                                {t("mya.v.selected")}
                              </span>
                            ) : null}
                          </span>
                          {later ? <span className="block text-sm text-muted">{t("vc.later")}</span> : null}
                        </span>
                      </label>
                      <button type="button" data-play={v.id} disabled={later} aria-pressed={here} aria-label={t(here ? "vc.stop.aria" : "vc.play.aria", { name: v.name })} onClick={() => play(v)} className={playBtn}>
                        {waiting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : here ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                        {t(here ? "vt.stop" : "vt.play")}
                      </button>
                    </div>
                  );
                })}
                      </div>
                    </div>
                  );
                })}
              </div>
              )
            )}
            <div className="min-h-5" aria-live="polite">
              {note === "saved" ? (
                <p role="status" className="m-0 mt-2 text-sm font-semibold text-green-text">
                  {t("vc.saved")}
                </p>
              ) : null}
            </div>
            {note && note !== "saved" ? (
              <p role="alert" className={`${alertBox} m-0 mt-1`}>
                {noteText[note]}
              </p>
            ) : null}
          </fieldset>
        </>
      ) : null}

      {state ? (
        <fieldset className="m-0 min-w-0 border-0 p-0" data-part="vc-tone">
          <legend className={`${h3} mb-1`}>{t("vc.tone.t")}</legend>
          <div role="radiogroup" aria-label={t("vc.tone.t")} className="flex flex-col">
            {toneList.map((o) => (
              <label key={o.id} className={`flex min-h-11 items-start gap-3 py-2 ${canEdit ? "cursor-pointer" : "opacity-80"}`}>
                <input type="radio" name="vc-tone" value={o.id} checked={tone === o.id} disabled={!canEdit} onChange={() => tone !== o.id && change({ tone: o.id })} className={`${radio} mt-0.5 ${open ? "!accent-[var(--v2-ink)]" : ""}`} />
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold text-ink">{o.label}</span>
                  <span className="block text-sm text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {turns ? (
            <div data-part="vc-example" aria-live="polite" lang={conversations?.[lang] ? lang : "en"} className={open ? "m-0 mt-2 border-t border-line pt-3 text-[15px] text-ink" : "m-0 mt-1 rounded-xl bg-surface-2 px-3.5 py-3 text-[15px] text-ink"}>
              <p className="m-0 text-sm font-semibold text-muted">{t("vc.cv.label")}</p>
              <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {turns.map((line, i) => (
                  <li key={i} data-from={i % 2 ? "assistant" : "customer"} className={i % 2 ? "ml-6" : "mr-6"}>
                    <span className="block text-sm text-muted">{i % 2 ? t("vc.cv.assistant") : t("vc.cv.customer")}</span>
                    {line}
                  </li>
                ))}
              </ol>
              {isDraft ? <span className="mt-2 block text-sm text-muted">{t("vc.ex.draft")}</span> : null}
            </div>
          ) : (
            <p data-part="vc-example" aria-live="polite" lang={exLang} className="m-0 mt-1 min-h-[5.5rem] rounded-xl bg-surface-2 px-3.5 py-3 text-[15px] text-ink">
              <span className="text-muted">{t("vt.ex.label")}</span> “{example}”
              {isDraft ? <span className="mt-1 block text-sm text-muted">{t("vc.ex.draft")}</span> : null}
            </p>
          )}
        </fieldset>
      ) : null}

      {bg ? (
        <fieldset className="m-0 min-w-0 border-0 p-0" data-part="vc-background">
          <legend className={`${h3} mb-1`}>{t("vc.bg.t")}</legend>
          <div role="radiogroup" aria-label={t("vc.bg.t")} className={open ? "flex flex-col" : "flex flex-wrap gap-x-5"}>
            {bg.options.map((o) => o.id).map((id) => (
              <label key={id} className={`flex min-h-11 items-center gap-2.5 text-[15px] ${canEdit ? "cursor-pointer" : "opacity-80"}`}>
                <input type="radio" name="vc-bg" value={id} checked={bg.value === id} disabled={!canEdit} onChange={() => bg.value !== id && change({ background: id })} className={`${radio} ${open ? "!accent-[var(--v2-ink)]" : ""}`} />
                {optionName(id)}
              </label>
            ))}
          </div>
          <p className={`${fieldHelp} mt-0`}>{t("vc.bg.d")}</p>
        </fieldset>
      ) : null}

      {sayAi ? (
        <div data-part="vc-sayai" className="flex flex-col">
          <button type="button" role="switch" aria-checked={sayAi.value} disabled={!canEdit} onClick={() => (sayAi.value ? (setAccepted(false), setOffAsk((o) => !o)) : change({ sayAi: true }))} aria-expanded={sayAi.value ? offAsk : undefined} className="inline-flex min-h-12 items-center gap-3 self-start rounded-lg pr-2 text-left text-[16px] font-semibold text-ink disabled:opacity-60">
            <span aria-hidden="true" className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border ${sayAi.value ? "border-brand-edge bg-brand" : "border-edge bg-surface-2"}`}>
              <span className={`absolute size-5 rounded-full shadow ${sayAi.value ? "left-6 bg-on-brand" : "left-1 bg-muted"}`} />
            </span>
            {t("vc.ai.t")}
          </button>
          <p className={`${fieldHelp} mt-0`}>{t("vc.ai.d")}</p>
          {!sayAi.value && sayAi.undertakingAt ? <p className={`${fieldHelp} mt-0`}>{t("vc.ai.off.since", { date: new Date(sayAi.undertakingAt).toLocaleDateString(uiLang === "en" ? "en-IN" : uiLang, { day: "numeric", month: "short", year: "numeric" }) })}</p> : null}
          {sayAi.value && offAsk ? (
            <div role="group" aria-labelledby="vc-ai-off-t" data-part="vc-ai-undertaking" className="mt-3 flex flex-col gap-3 border-y border-line py-4">
              <h3 id="vc-ai-off-t" className="m-0 text-[16px] font-semibold text-ink">{t("vc.ai.off.t")}</h3>
              <p className={`${fieldHelp} m-0`}>{t("vc.ai.off.draft")}</p>
              <ul className="m-0 list-disc pl-5 text-[15px] text-ink">
                {[1, 2, 3, 4].map((n) => <li key={n}>{t(`vc.ai.off.${n}` as "vc.ai.off.1")}</li>)}
              </ul>
              <Tick id="vc-ai-accept" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} label={<span className="text-[15px] font-semibold text-ink">{t("vc.ai.off.accept")}</span>} />
              <p className={`${fieldHelp} m-0`}>{t("vc.ai.off.date", { date: new Date().toLocaleDateString(uiLang === "en" ? "en-IN" : uiLang, { day: "numeric", month: "short", year: "numeric" }) })}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnMain} disabled={!accepted || saving} onClick={() => { change({ sayAi: false, sayAiUndertaking: true }); setOffAsk(false); }}>{t("vc.ai.off.go")}</button>
                <button type="button" className={btnQuiet} onClick={() => setOffAsk(false)}>{t("vc.ai.off.keep")}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {speaksNote?.ok ? (
        <p role="status" className={`${okBox} m-0`}>
          {t("vc.saved")}
        </p>
      ) : null}
      {speaksErr ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {speaksErr}
          {speaksNote && !speaksNote.ok && speaksNote.error === "mfa" ? (
            <>
              {" "}
              <a href={securityHref} className="font-semibold underline">
                {t("today.err.mfa.link")}
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {testCallHref ? (
        <div data-part="vc-testcall" className="flex flex-col items-start gap-1">
          <Link href={testCallHref} className={btnQuiet}>
            {t("vc.test")}
          </Link>
          <p className={`${fieldHelp} mt-0`}>{t("vc.test.d")}</p>
        </div>
      ) : null}
    </section>
  );
}
