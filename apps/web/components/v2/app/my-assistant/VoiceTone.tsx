"use client";

import { Check, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { type CallLang } from "@/lib/assistant/types";
import { LAUNCH_LANGS, withKept } from "@/lib/languages";
import { SAMPLE_CUSTOMER, SAMPLE_ROLE, fillOpening, unknownPlaceholders, type Placeholder } from "@/lib/opening-line/types";
import { STYLES, SPEAK_LANGS, TONES, type HowSpeaks, type SpeakLang, type SpeakStyle, type SpeakTone } from "@/lib/talk-training/speaks";
import { ADDRESSES, LIMITS, type TalkError, type TalkTrainingState } from "@/lib/talk-training/types";
import { sampleUrl } from "@/lib/voice-samples/types";
import type { Gender, PickerLang, PickerVoice } from "@/lib/voice-picker/types";

import { draftOf, changeOf, type Draft, type SpeaksPanel } from "../assistant/HowAssistantSpeaks";
import { Instructions, List, Pairs, SayLikes, type TalkTrainingActions } from "../assistant/TalkTraining";
import { Choose, MoreChoices, Sentence } from "../jobs/rules/parts";
import { alertBox, btnMain, btnQuiet, checkRow, fieldHelp, okBox } from "../ui";
import { makeT, type Words } from "../words";
import { GreetingBox, shownGreeting, type GreetingHandle } from "./GreetingBox";
import { inUseId, SOUNDS, voiceFor } from "./sounds";
import type { ChooseVoice } from "./VoiceCards";

const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const h3 = "m-0 text-[16px] font-semibold text-ink";
const GREETING_NAMES = ["customer", "business", "assistant"] as const satisfies readonly Placeholder[];

export type VoiceToneProps = {
  words?: Words;
  /** The app's language: the example under "Speak to customers" is written in it */
  uiLang: string;
  /** The three sounds (the voice picker); null = not there */
  picker: { voices: readonly PickerVoice[]; choices: Partial<Record<PickerLang, string | null>>; gender: Gender; fake: boolean } | null;
  languages: readonly PickerLang[];
  first: CallLang;
  endpoint: string;
  choose: ChooseVoice;
  /** The greeting and the rest of Talk training; null = not there */
  training: TalkTrainingState | null;
  actions: TalkTrainingActions;
  canEdit: boolean;
  securityHref: string;
  /** Tone and Words (How your assistant speaks); null = not there */
  speaks: SpeaksPanel | null;
  offered?: readonly CallLang[];
  langNames: Record<CallLang, string>;
  business: string | null;
  assistantName: string | null;
  /** "Hear it" beside the greeting: this workspace's voice-sample route; null = not there */
  hearIt: { endpoint: string } | null;
  /** The say-it-like-this list and what goes into the instructions (APP_V4) */
  v4?: boolean;
};

type Msg = { ok: true } | { ok: false; from: "doc"; error: TalkError } | { ok: false; from: "speaks"; error: string };

/**
 * Voice & tone as ONE plain card, "How your assistant sounds" (owner, 19 Nov 2026: "these settings are not clear, simplify all these"): a voice (three, each with one play button and one line), "Speak to customers: [Friendly | Respectful]" with
 * a live example, and the greeting in one box with a "Hear it" button. Everything else is under "More choices" on the same page. Nothing about how it is saved changed: the voice is saved at once (the voice picker's action), the greeting and the lists go
 * in the whole Talk training document, Tone and Words in the speaks change (only what changed), each with the Owner's second step; one Save sends both. Region and Introduce as are not drawn here (Introduce as is on Place a test call; Region stays in the data and the
 * save, ready to come back).
 */
export function VoiceTone({ words, uiLang, picker, languages, first, endpoint, choose, training, actions, canEdit, securityHref, speaks, offered = LAUNCH_LANGS, langNames, business, assistantName, hearIt, v4 = false }: VoiceToneProps) {
  const t = makeT(words);
  const router = useRouter();
  const [lang, setLang] = React.useState<CallLang>(first);
  // voice
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Partial<Record<PickerLang, string>>>({});
  const [voiceNote, setVoiceNote] = React.useState<"saved" | "error" | "sample" | null>(null);
  const [voiceBusy, startVoice] = React.useTransition();
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => audio.current?.pause(), []);
  // the greeting and the rest of Talk training
  const [state, setState] = React.useState<TalkTrainingState | null>(training);
  const [doc, setDoc] = React.useState(training?.training ?? null);
  const [dirty, setDirty] = React.useState(false);
  const [rev, setRev] = React.useState(0); // a new answer from the API remounts the greeting box (it is not controlled while it is typed in)
  const [confirmReset, setConfirmReset] = React.useState(false);
  // tone and words
  const [speaksState, setSpeaksState] = React.useState<HowSpeaks | null>(speaks?.initial ?? null);
  const [d, setD] = React.useState<Draft | null>(speaks ? draftOf(speaks.initial) : null);
  const [perLang, setPerLang] = React.useState(() => (speaks ? !SPEAK_LANGS.every((l) => speaks.initial.words[l].style === speaks.initial.words.te.style) : false));
  const [wordsLang, setWordsLang] = React.useState<SpeakLang>("te");
  const [msg, setMsg] = React.useState<Msg | null>(null);
  const [busy, start] = React.useTransition();
  const off = !canEdit || busy;
  const greetRef = React.useRef<GreetingHandle>(null);
  const [hearing, setHearing] = React.useState(false);

  const chips: CallLang[] = [...new Set<CallLang>([...(picker ? (languages as readonly CallLang[]) : []), ...withKept(offered, ...Object.keys(doc?.greeting ?? {}), first)])];
  const pickLang = (languages as readonly string[]).includes(lang) ? (lang as PickerLang) : null;

  // ---- voice ----
  const current = picker && pickLang ? (picked[pickLang] ?? inUseId(picker.voices, picker.choices, pickLang, picker.gender)) : null;
  const play = (id: string) => {
    audio.current?.pause();
    if (playing === id) return setPlaying(null);
    setVoiceNote(null);
    const a = new Audio(`${endpoint}?id=${encodeURIComponent(id)}`);
    audio.current = a;
    a.onended = () => setPlaying((p) => (p === id ? null : p));
    a.onerror = () => {
      setPlaying(null);
      setVoiceNote("sample");
    };
    setPlaying(id);
    a.play().catch(() => {
      setPlaying(null);
      setVoiceNote("sample");
    });
  };
  const use = (v: PickerVoice) => {
    if (!pickLang) return;
    const language = pickLang;
    startVoice(async () => {
      audio.current?.pause();
      setPlaying(null);
      setVoiceNote(null);
      setPicked((p) => ({ ...p, [language]: v.id }));
      const out = await choose(language, v.isDefault ? null : v.id).catch(() => ({ ok: false as const, error: "down" }));
      if (out.ok) {
        setVoiceNote("saved");
        router.refresh();
      } else {
        setPicked((p) => ({ ...p, [language]: undefined }));
        setVoiceNote("error");
      }
    });
  };

  // ---- the document ----
  const change = (next: Partial<NonNullable<typeof doc>>) => {
    setDoc((x) => (x ? { ...x, ...next } : x));
    setDirty(true);
    setMsg(null);
  };
  const answeredDoc = (data: TalkTrainingState) => {
    setState(data);
    setDoc(data.training);
    setDirty(false);
    setConfirmReset(false);
    setRev((r) => r + 1);
  };
  const touch = (next: Draft) => (setD(next), setMsg(null));
  const speaksChange = speaksState && d ? changeOf(speaksState, d) : null;
  const anyUnknown = doc ? Object.values(doc.greeting).some((g) => g !== undefined && unknownPlaceholders(g).length > 0) : false;
  const canSave = (dirty || speaksChange !== null) && !anyUnknown;
  const save = () => {
    start(async () => {
      setMsg(null);
      if (dirty && doc) {
        const out = await actions.save(doc);
        if (!out.ok) return setMsg({ ok: false, from: "doc", error: out.error });
        answeredDoc(out.data);
      }
      if (speaks && speaksChange) {
        const out = await speaks.save(speaksChange);
        if (!out.ok) return setMsg({ ok: false, from: "speaks", error: out.error });
        setSpeaksState(out.data);
        setD(draftOf(out.data));
      }
      setMsg({ ok: true });
    });
  };
  const reset = () =>
    start(async () => {
      const out = await actions.reset();
      if (!out.ok) return setMsg({ ok: false, from: "doc", error: out.error });
      answeredDoc(out.data);
      setMsg({ ok: true });
    });

  // ---- the greeting ----
  const pillText = (name: Placeholder) => t(`vt.ph.${name}` as "vt.ph.customer");
  const greetingText = doc && state ? shownGreeting(doc.greeting[lang], state.defaults.greeting[lang]) : "";
  const unknownHere = unknownPlaceholders(doc?.greeting[lang] ?? "");
  const hear = () => {
    if (!hearIt) return;
    audio.current?.pause();
    if (hearing) return setHearing(false);
    const a = new Audio(sampleUrl(hearIt.endpoint, { voice: "female_warm", lang, tone: "warm", name: "" }));
    audio.current = a;
    a.onended = () => setHearing(false);
    a.onerror = () => setHearing(false);
    setHearing(true);
    a.play().catch(() => setHearing(false));
  };

  // ---- tone and words ----
  const toneText = (v: string) => (speaksState && v === speaksState.tone.packDefault ? t("vt.usual", { tone: t(`sp.tone.${v}` as "sp.tone.friendly") }) : t(`sp.tone.${v}` as "sp.tone.friendly"));
  const exampleOf = (tone: SpeakTone) => t(`vt.ex.${tone}` as "vt.ex.friendly", { name: "Ravi" });
  const setAllStyle = (x: SpeakStyle) => d && touch({ ...d, words: Object.fromEntries(SPEAK_LANGS.map((l) => [l, { ...d.words[l], style: x }])) as Draft["words"] });
  const setStyleOf = (l: SpeakLang, x: SpeakStyle) => d && touch({ ...d, words: { ...d.words, [l]: { ...d.words[l], style: x } } });
  const styleIs = (l: SpeakLang, x: SpeakStyle) => d?.words[l].style === x; // (a helper outside the markup: the source audit refuses "style" next to a className)
  const allSame = d ? SPEAK_LANGS.every((l) => d.words[l].style === d.words.te.style) : true;

  const speaksErr = msg && !msg.ok && msg.from === "speaks" ? (t(`sp.err.${msg.error}`) !== `sp.err.${msg.error}` ? t(`sp.err.${msg.error}`) : msg.error === "introduce" ? t("tt.err.introduce_as") : t("sp.err.rejected")) : null;
  const docErr = msg && !msg.ok && msg.from === "doc" ? t(`tt.err.${msg.error}` as "tt.err.down") : null;
  const mfa = msg && !msg.ok && msg.error === "mfa";
  const anything = picker !== null || training !== null;
  if (!anything) return null;

  return (
    <section data-part="mya-voice-tone" aria-labelledby="vt-h" className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 md:p-5">
      <div>
        <h2 id="vt-h" className="m-0 font-display text-[18px] font-bold leading-tight md:text-xl">
          {t("vt.title")}
        </h2>
        {speaks?.demo ? (
          <p className={`${fieldHelp} rounded-lg bg-surface-2 px-3 py-2`} data-part="sp-notsaved">
            {t("sp.notsaved")}
          </p>
        ) : null}
        {picker?.fake ? <p className={`${fieldHelp} rounded-lg bg-surface-2 px-3 py-2`}>{t("vp.mock")}</p> : null}
        {canEdit || !training ? null : <p className={fieldHelp}>{t("tt.owneronly")}</p>}
      </div>

      {chips.length > 1 ? (
        <div role="group" aria-label={t("vt.lang")} className="flex flex-wrap gap-2" data-part="vt-lang">
          {chips.map((l) => (
            <button key={l} type="button" aria-pressed={l === lang} onClick={() => (setVoiceNote(null), setLang(l))} className={chip(l === lang)}>
              {langNames[l]}
              {doc?.greeting[l] !== undefined ? <span aria-hidden="true"> ·</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {picker ? (
        <fieldset className="m-0 min-w-0 border-0 p-0" data-part="vt-voice">
          <legend className={`${h3} mb-1`}>{t("vt.voice")}</legend>
          <div role="radiogroup" aria-label={t("vt.voice")} className="flex flex-col">
            {SOUNDS.map((s) => {
              const v = pickLang ? voiceFor(picker.voices, s, pickLang, picker.gender, current) : null;
              const on = v !== null && v.id === current;
              return (
                <div key={s} data-sound={s} data-selected={on ? "true" : "false"} className="flex min-h-14 items-center gap-2 py-1">
                  <label className={`flex min-h-11 min-w-0 flex-1 items-start gap-3 py-1.5 ${v ? "cursor-pointer" : "opacity-70"}`}>
                    <input type="radio" name="vt-voice" value={s} checked={on} disabled={v === null || voiceBusy} onChange={() => v && use(v)} className="mt-0.5 size-5 shrink-0 accent-brand-text" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                        {t(`mya.v.${s}` as "mya.v.warm")}
                        {on ? (
                          <span data-part="mya-inuse" className="inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-on-brand">
                            <Check className="size-3.5" aria-hidden="true" />
                            {t("mya.v.selected")}
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-sm text-muted">{v ? t(`mya.v.${s}.d` as "mya.v.warm.d") : t("mya.v.none")}</span>
                    </span>
                  </label>
                  {v?.sampleUrl ? (
                    <button type="button" aria-pressed={playing === v.id} aria-label={`${t(playing === v.id ? "vt.stop" : "vt.play")}: ${t(`mya.v.${s}` as "mya.v.warm")}`} data-play={s} onClick={() => play(v.id)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-edge bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
                      {playing === v.id ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                      {t(playing === v.id ? "vt.stop" : "vt.play")}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {voiceNote === "saved" ? (
            <p role="status" className={`${okBox} m-0 mt-2`}>
              {t("mya.v.saved")}
            </p>
          ) : null}
          {voiceNote === "error" ? (
            <p role="alert" className={`${alertBox} m-0 mt-2`}>
              {t("mya.v.err")}
            </p>
          ) : null}
          {voiceNote === "sample" ? (
            <p role="alert" className={`${alertBox} m-0 mt-2`}>
              {t("vp.err.sample")}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {speaksState && d ? (
        <div data-part="vt-tone" className="flex flex-col gap-1">
          <Sentence line="tone" template={t("vt.speak")} parts={{ tone: (aria) => <Choose aria={aria} value={d.tone} options={TONES} text={toneText} disabled={off} onChange={(v) => touch({ ...d, tone: v as SpeakTone })} /> }} />
          <p data-part="vt-example" aria-live="polite" lang={uiLang} className="m-0 text-[15px] text-muted">
            {t("vt.ex.label")} <span className="font-medium text-ink">“{exampleOf(d.tone)}”</span>
          </p>
          {speaksState.tone.source === "migrated" ? (
            <p className={fieldHelp} data-part="sp-tone-source">
              {t("sp.tone.migrated")}
            </p>
          ) : null}
        </div>
      ) : null}

      {doc && state ? (
        <div data-part="vt-greeting" className="flex flex-col gap-2">
          <p id="vt-greet-h" className={h3}>
            {t("vt.greet")}
          </p>
          <GreetingBox
            key={`${lang}-${rev}`}
            id="vt-greeting"
            label={t("vt.greet")}
            value={greetingText}
            lang={lang}
            disabled={off}
            maxLength={LIMITS.greeting.max}
            pillText={pillText}
            ref={greetRef}
            onChange={(stored) => {
              const greeting = { ...doc.greeting };
              if (stored.trim() === "") delete greeting[lang];
              else greeting[lang] = stored;
              change({ greeting });
            }}
          />
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2" data-part="vt-greeting-add">
              {GREETING_NAMES.map((p) => (
                <button key={p} type="button" disabled={off} onClick={() => greetRef.current?.insert(p)} className="min-h-11 rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold hover:bg-surface-2">
                  {t("vt.add", { what: pillText(p) })}
                </button>
              ))}
            </div>
          ) : null}
          {unknownHere.length > 0 ? (
            <p role="alert" className="m-0 text-sm font-medium text-red-text" data-part="tt-greeting-unknown">
              {t("vt.greet.braces")}
            </p>
          ) : null}
          {hearIt ? (
            <div className="flex flex-wrap gap-2" data-part="tt-greeting-hear">
              <button type="button" aria-pressed={hearing} onClick={hear} className={btnQuiet}>
                {hearing ? <Pause className="mr-1.5 size-4" aria-hidden="true" /> : <Play className="mr-1.5 size-4" aria-hidden="true" />}
                {t(hearing ? "vt.stop" : "vt.hear")}
              </button>
            </div>
          ) : null}
          {greetingText.trim() !== "" ? (
            <div className="rounded-xl bg-surface-2 px-3.5 py-3" data-part="tt-greeting-preview">
              <p className="m-0 text-sm font-semibold text-muted">{t("ope.preview")}</p>
              <p lang={lang} className="m-0 mt-1 text-[16px]" aria-live="polite">
                {fillOpening(greetingText, { customer: SAMPLE_CUSTOMER[lang], assistant: assistantName ?? "…", business: business ?? "…", agent_role: SAMPLE_ROLE[lang] })}
              </p>
            </div>
          ) : null}
          <p className="m-0 text-sm text-muted">{t("vt.greet.help")}</p>
          <p className="m-0 text-sm text-muted" data-part="ai-always">
            {t("tt.ai.always")}
          </p>
        </div>
      ) : null}

      {doc && state ? (
        <MoreChoices title={t("vt.more.t")} sub={t("vt.more.sub")}>
          {speaksState && d ? (
            <fieldset data-part="sp-words" className="m-0 min-w-0 border-0 p-0">
              <legend className={h3}>{t("sp.words")}</legend>
              {perLang ? (
                <>
                  <div role="group" aria-label={t("sp.words.for")} className="mt-2 flex flex-wrap gap-2">
                    {SPEAK_LANGS.map((l) => (
                      <button key={l} type="button" aria-pressed={l === wordsLang} onClick={() => setWordsLang(l)} className={chip(l === wordsLang)}>
                        {langNames[l]}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-col">
                    {STYLES.map((x) => (
                      <label key={x} className={checkRow}>
                        <input type="radio" name={`sp-words-${wordsLang}`} value={x} checked={styleIs(wordsLang, x)} disabled={off} onChange={() => setStyleOf(wordsLang, x)} className="size-5 shrink-0 accent-brand-text" />
                        <span>
                          {t(`sp.words.${x}`)}
                          <span className={`${fieldHelp} block`}>{t(`sp.words.${x}.help`)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <button type="button" className="mt-1 min-h-11 text-sm font-semibold text-brand-text underline underline-offset-4" onClick={() => setPerLang(false)} data-part="sp-words-one">
                    {t("sp.words.one")}
                  </button>
                </>
              ) : (
                <>
                  <div className="mt-1 flex flex-col" data-part="sp-words-all">
                    {STYLES.map((x) => (
                      <label key={x} className={checkRow}>
                        <input type="radio" name="sp-words-all" value={x} checked={allSame && styleIs("te", x)} disabled={off} onChange={() => setAllStyle(x)} className="size-5 shrink-0 accent-brand-text" />
                        <span>
                          {t(`sp.words.${x}`)}
                          <span className={`${fieldHelp} block`}>{t(`sp.words.${x}.help`)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {allSame ? null : (
                    <p className={fieldHelp} data-part="sp-words-differ">
                      {t("sp.words.differ")}
                    </p>
                  )}
                  <button type="button" className="mt-1 min-h-11 text-sm font-semibold text-brand-text underline underline-offset-4" onClick={() => setPerLang(true)} data-part="sp-words-perlang">
                    {t("sp.words.perlang")}
                  </button>
                </>
              )}
            </fieldset>
          ) : null}

          <fieldset data-part="tt-address" className="m-0 min-w-0 border-0 p-0">
            <legend className={h3}>{t("tt.address")}</legend>
            <div className="mt-1 flex flex-col">
              {ADDRESSES.map((a) => (
                <label key={a} className={checkRow}>
                  <input type="radio" name="tt-address" value={a} checked={doc.address === a} disabled={off} onChange={() => change({ address: a })} className="size-5 shrink-0 accent-brand-text" />
                  {t(`tt.address.${a}` as "tt.address.plain")}
                </label>
              ))}
            </div>
          </fieldset>

          <List id="never" t={t} items={doc.neverSay} max={LIMITS.neverSay.count} length={LIMITS.neverSay.max} off={off} onChange={(neverSay) => change({ neverSay })} />
          {v4 && doc.sayLike !== null ? <SayLikes t={t} items={doc.sayLike} off={off} onChange={(sayLike) => change({ sayLike })} /> : null}
          <List id="questions" t={t} items={doc.questions} max={LIMITS.question.count} length={LIMITS.question.max} off={off} onChange={(questions) => change({ questions })} numbered />
          <Pairs id="objections" t={t} items={doc.objections} max={LIMITS.objection.count} length={LIMITS.objection.max} off={off} onChange={(objections) => change({ objections })} onSavePair={(a, b) => start(async () => { const out = await actions.save({ ...doc, objections: [...doc.objections, { a, b }] }); if (out.ok) { answeredDoc(out.data); setMsg({ ok: true }); } else setMsg({ ok: false, from: "doc", error: out.error }); })} />
          <Pairs id="examples" t={t} items={doc.examples} max={LIMITS.example.count} length={LIMITS.example.max} off={off} onChange={(examples) => change({ examples })} onSavePair={(a, b) => start(async () => { const out = await actions.save({ ...doc, examples: [...doc.examples, { a, b }] }); if (out.ok) { answeredDoc(out.data); setMsg({ ok: true }); } else setMsg({ ok: false, from: "doc", error: out.error }); })} />
          {v4 ? <Instructions t={t} doc={doc} /> : null}
          {state.rules.length > 0 ? (
            <div className="rounded-xl bg-surface-2 p-4" data-part="tt-rules">
              <p className={h3}>{t("tt.rules")}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                {state.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </MoreChoices>
      ) : null}

      {canEdit && (training || speaks) ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy || !canSave} className={btnMain} data-part="vt-save">
            {busy ? t("tt.saving") : t("sp.save")}
          </button>
          {confirmReset ? (
            <>
              <span className="text-sm text-muted">{t("tt.reset.sure")}</span>
              <button type="button" onClick={reset} disabled={busy} className={btnQuiet}>
                {t("tt.reset.yes")}
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} disabled={busy} className={btnQuiet}>
                {t("tt.reset.no")}
              </button>
            </>
          ) : state?.saved ? (
            <button type="button" onClick={() => setConfirmReset(true)} disabled={busy} className={btnQuiet}>
              {t("tt.reset")}
            </button>
          ) : null}
        </div>
      ) : null}
      {msg?.ok ? (
        <p role="status" className={`${okBox} m-0`}>
          {t("tt.saved")}
        </p>
      ) : null}
      {docErr || speaksErr ? (
        <p role="alert" className={`${alertBox} m-0`}>
          {docErr ?? speaksErr}
          {mfa ? (
            <>
              {" "}
              <a href={securityHref} className="font-semibold underline">
                {t("today.err.mfa.link")}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
