"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";

import { type CallLang } from "@/lib/assistant/types";
import { LAUNCH_LANGS, withKept } from "@/lib/languages";
import { SAMPLE_CUSTOMER, SAMPLE_ROLE, fillOpening, unknownPlaceholders, type Placeholder } from "@/lib/opening-line/types";
import { STYLES, SPEAK_LANGS, type HowSpeaks, type SpeakLang, type SpeakStyle } from "@/lib/talk-training/speaks";
import { ADDRESSES, LIMITS, type TalkError, type TalkTrainingState } from "@/lib/talk-training/types";
import type { Preview } from "@/lib/opening-line/types";

import { draftOf, changeOf, type Draft, type SpeaksPanel } from "../assistant/HowAssistantSpeaks";
import { Instructions, List, Pairs, SayLikes, type TalkTrainingActions } from "../assistant/TalkTraining";
import { MoreChoices } from "../jobs/rules/parts";
import { alertBox, btnMain, btnQuiet, checkRow, fieldHelp, okBox } from "../ui";
import { makeT, type Words } from "../words";
import { GreetingBox, shownGreeting, type GreetingHandle } from "./GreetingBox";

const chip = (on: boolean) => `min-h-11 rounded-md border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const h3 = "m-0 text-[16px] font-semibold text-ink";
const GREETING_NAMES = ["customer", "business", "assistant"] as const satisfies readonly Placeholder[];

export type PreviewFn = (language: CallLang, text: string, mentionAi: boolean | null, unsaved: boolean) => Promise<{ ok: true; preview: Preview } | { ok: false; error: string }>;

export type VoiceToneProps = {
  words?: Words;
  /** The name of the voice that speaks in each language now (from the voice card's list); the note under "Hear it" says it */
  voiceNames: Partial<Record<string, string>>;
  first: CallLang;
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
  /** "Hear it" beside the greeting: the opening-line preview (the greeting as it is on the screen, in the voice in force, nothing saved); null = not there */
  hearIt: PreviewFn | null;
  /** The business's switch "Say 'AI assistant' when greeting" (default OFF) and the suggested greeting of each language as that switch stands (the opening line's default with or without the AI sentence); null = the Talk training suggestion stands */
  sayAi?: boolean | null;
  suggested?: Partial<Record<string, string>> | null;
  /** The say-it-like-this list and what goes into the instructions (APP_V4) */
  v4?: boolean;
};

type Msg = { ok: true } | { ok: false; from: "doc"; error: TalkError } | { ok: false; from: "speaks"; error: string };

/**
 * Voice & tone, the second card, "Greeting and more choices" (owner, 19 Nov 2026: "simplify all these"; 20 Nov: the voice, the tone, the background and the test call moved to the voice card, VoiceCard.tsx): the greeting in one box with a "Hear it" button, and under "More choices" the words
 * per language, how to address people, what never to say, and the questions and answers. The greeting and the lists go in the whole Talk training document, Words in the speaks change (only what changed), each with the Owner's second step; one Save sends both. Introduce as is on Place a test call.
 */
export function VoiceTone({ words, voiceNames, first, training, actions, canEdit, securityHref, speaks, offered = LAUNCH_LANGS, langNames, business, assistantName, hearIt, sayAi = null, suggested = null, v4 = false }: VoiceToneProps) {
  const t = makeT(words);
  const [lang, setLang] = React.useState<CallLang>(first);
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
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => audio.current?.pause(), []);

  const chips: CallLang[] = [...new Set<CallLang>(withKept(offered, ...Object.keys(doc?.greeting ?? {}), first))];

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
  const suggestion = suggested?.[lang] ?? state?.defaults.greeting[lang]; // FOLLOWS THE SWITCH: the suggestion is the one with or without the AI sentence as "Say AI assistant when greeting" stands (the page is read again when it is toggled)
  // (a new suggestion from the page, after the switch was toggled, gives the greeting box a new key: it is not controlled while it is typed in)
  const greetingText = doc && state ? shownGreeting(doc.greeting[lang], suggestion) : "";
  const unknownHere = unknownPlaceholders(doc?.greeting[lang] ?? "");
  // "Hear it": the greeting AS IT IS ON THE SCREEN (the pills filled with the example names, as in the line under the box), in the voice in force (the one chosen in the voice card above, saved the moment it is chosen) and the saved tone: the API speaks it the way a call does.
  const [heard, setHeard] = React.useState(false);
  const [hearNote, setHearNote] = React.useState<"words" | "none" | "error" | null>(null);
  const hear = () => {
    if (!hearIt) return;
    audio.current?.pause();
    if (hearing) return setHearing(false);
    const text = fillOpening(greetingText, { customer: SAMPLE_CUSTOMER[lang], assistant: assistantName ?? "{assistant}", business: business ?? "{business}", agent_role: SAMPLE_ROLE[lang] });
    setHearing(true);
    setHearNote(null);
    setHeard(true);
    void hearIt(lang, text, sayAi, true)
      .catch(() => ({ ok: false as const, error: "down" }))
      .then((out) => {
        if (!out.ok) {
          setHearing(false);
          return setHearNote(out.error === "unsupported" ? "words" : "error");
        }
        const a = out.preview.audio;
        if (!a) {
          setHearing(false);
          return setHearNote("none");
        }
        // a blob: address, not a data: one: the page's media rule allows only this app's own address and blob: (lib/security/csp.ts)
        const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0))], { type: a.mime }));
        const player = new Audio(url);
        audio.current = player;
        const end = () => {
          URL.revokeObjectURL(url);
          setHearing(false);
        };
        player.onended = end;
        player.onerror = () => (end(), setHearNote("error"));
        player.play().catch(() => (end(), setHearNote("error")));
      });
  };
  const voiceName = voiceNames[lang];

  // ---- words ----
  const setAllStyle = (x: SpeakStyle) => d && touch({ ...d, words: Object.fromEntries(SPEAK_LANGS.map((l) => [l, { ...d.words[l], style: x }])) as Draft["words"] });
  const setStyleOf = (l: SpeakLang, x: SpeakStyle) => d && touch({ ...d, words: { ...d.words, [l]: { ...d.words[l], style: x } } });
  const styleIs = (l: SpeakLang, x: SpeakStyle) => d?.words[l].style === x; // (a helper outside the markup: the source audit refuses "style" next to a className)
  const allSame = d ? SPEAK_LANGS.every((l) => d.words[l].style === d.words.te.style) : true;

  const speaksErr = msg && !msg.ok && msg.from === "speaks" ? (t(`sp.err.${msg.error}`) !== `sp.err.${msg.error}` ? t(`sp.err.${msg.error}`) : msg.error === "introduce" ? t("tt.err.introduce_as") : t("sp.err.rejected")) : null;
  const docErr = msg && !msg.ok && msg.from === "doc" ? t(`tt.err.${msg.error}` as "tt.err.down") : null;
  const mfa = msg && !msg.ok && msg.error === "mfa";
  if (training === null) return null;

  return (
    <section data-part="mya-voice-tone" aria-labelledby="vt-h" className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4 md:p-5">
      <div>
        <h2 id="vt-h" className="m-0 font-display text-[18px] font-bold leading-tight md:text-xl">
          {t("vt.gm.title")}
        </h2>
        {speaks?.demo ? (
          <p className={`${fieldHelp} rounded-lg bg-surface-2 px-3 py-2`} data-part="sp-notsaved">
            {t("sp.notsaved")}
          </p>
        ) : null}
        {canEdit ? null : <p className={fieldHelp}>{t("tt.owneronly")}</p>}
      </div>

      {chips.length > 1 ? (
        <div role="group" aria-label={t("vt.lang")} className="flex flex-wrap gap-2" data-part="vt-lang">
          {chips.map((l) => (
            <button key={l} type="button" aria-pressed={l === lang} onClick={() => setLang(l)} className={chip(l === lang)}>
              {langNames[l]}
              {doc?.greeting[l] !== undefined ? <span aria-hidden="true"> ·</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {doc && state ? (
        <div data-part="vt-greeting" className="flex flex-col gap-2">
          <p id="vt-greet-h" className={h3}>
            {t("vt.greet")}
          </p>
          <GreetingBox
            key={`${lang}-${rev}-${suggestion ?? ""}`}
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
                <button key={p} type="button" disabled={off} onClick={() => greetRef.current?.insert(p)} className="min-h-11 rounded-md border border-edge bg-surface px-3.5 text-sm font-semibold hover:bg-surface-2">
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
          {hearIt && heard ? (
            <p className="m-0 text-sm text-muted" data-part="vt-hear-limit">
              {hearNote === "words" ? t("vt.hear.words") : hearNote === "none" ? t("vt.hear.none") : hearNote === "error" ? t("vp.err.sample") : voiceName ? t("vt.hear.limit", { voice: voiceName }) : t("vt.hear.limit2")}
            </p>
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
