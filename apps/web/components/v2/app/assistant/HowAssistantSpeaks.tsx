"use client";

import * as React from "react";

import type { CallLang } from "@/lib/assistant/types";
import { introduceProblem, type IntroduceAs } from "@/lib/talk-training/introduce";
import { EXAMPLE_LANGS, REGION_LANGS, REGIONS, regionKey, SPEAK_LANGS, STYLES, TONES, type ExampleLang, type HowSpeaks, type RegionLang, type SpeakLang, type SpeaksChange, type SpeakStyle, type SpeakTone } from "@/lib/talk-training/speaks";
import { exampleLine } from "@/lib/talk-training/speaks-examples";

import { alertBox, btnMain, checkRow, fieldHelp, noteBox, okBox } from "../ui";
import type { Say } from "../words";
import { IntroduceAsField } from "./IntroduceAsField";

const h3 = "text-base font-semibold text-ink";
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const hearBtn = "mt-2 inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2";

export type SpeaksOut = { ok: true; data: HowSpeaks } | { ok: false; error: string };
export type SpeaksPanel = { initial: HowSpeaks; /** the test mode (made-up choices kept in this browser): the panel says so */ demo: boolean; save: (change: SpeaksChange) => Promise<SpeaksOut> };

type Draft = { tone: SpeakTone; words: Record<SpeakLang, { style: SpeakStyle; region: string }>; introduceAs: IntroduceAs };
const draftOf = (h: HowSpeaks): Draft => ({
  tone: h.tone.value,
  words: Object.fromEntries(SPEAK_LANGS.map((l) => [l, { style: h.words[l].style, region: h.words[l].region }])) as Draft["words"],
  introduceAs: { kind: h.introduceAs.kind, text: h.introduceAs.text },
});

/** What changed since the last saved answer: only that is sent (the contract: a key left out is not changed). Nothing changed = null. */
export function changeOf(from: HowSpeaks, d: Draft): SpeaksChange | null {
  const c: SpeaksChange = {};
  if (d.tone !== from.tone.value) c.tone = d.tone;
  for (const l of SPEAK_LANGS) {
    const a = from.words[l];
    const b = d.words[l];
    if (a.style !== b.style || a.region !== b.region) (c.words ??= {})[l] = { ...(a.style !== b.style ? { style: b.style } : {}), ...(a.region !== b.region ? { region: b.region } : {}) };
  }
  const ia = d.introduceAs;
  if (ia.kind !== from.introduceAs.kind || (ia.kind !== "business" && (ia.text ?? "").trim() !== (from.introduceAs.text ?? "").trim())) c.introduceAs = ia;
  return Object.keys(c).length === 0 ? null : c;
}

/**
 * "How your assistant speaks" (owner decision 11 Nov 2026; C1's fixed contract docs/contracts/how-assistant-speaks.md), one panel in Talk training for every business: Tone (Respectful, Friendly; Casual is only on an owner test call), Words (everyday with English words, or
 * with fewer; no Formal) for each language, Region (Telugu, Kannada, Tamil) and Introduce as (moved here), each with "Hear an example" (a written sample line for now). It replaces "How to address customers": an old setting is shown as the tone it maps to, and says so. One Save sends only what
 * changed (Owner and the second factor). A language's choices are chosen per language, as the API keeps them.
 */
export function HowAssistantSpeaks({ t, langNames, business, off, panel, securityHref }: { t: Say; langNames: Record<CallLang, string>; business: string | null; off: boolean; panel: SpeaksPanel; securityHref: string }) {
  const [state, setState] = React.useState(panel.initial);
  const [d, setD] = React.useState<Draft>(() => draftOf(panel.initial));
  const [wordsLang, setWordsLang] = React.useState<SpeakLang>("te");
  const [perLang, setPerLang] = React.useState(() => !SPEAK_LANGS.every((l) => panel.initial.words[l].style === panel.initial.words.te.style)); // one choice for all languages by default; "set per language" opens the chooser (and it opens by itself where the languages already differ)
  const [regionLang, setRegionLang] = React.useState<RegionLang>("te");
  const [hear, setHear] = React.useState<"tone" | "words" | "region" | null>(null);
  const [exLang, setExLang] = React.useState<ExampleLang>("te");
  const [msg, setMsg] = React.useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [busy, start] = React.useTransition();
  const change = changeOf(state, d);
  const introBad = introduceProblem({ kind: d.introduceAs.kind, text: d.introduceAs.kind === "business" ? null : d.introduceAs.text });
  const touch = (next: Draft) => (setD(next), setMsg(null));
  const isWordStyle = (l: SpeakLang, x: SpeakStyle) => d.words[l].style === x; // (a helper outside the markup: the source audit refuses "style" next to a className)
  const setWordStyle = (l: SpeakLang, x: SpeakStyle) => setWord(l, { style: x });
  const allSame = SPEAK_LANGS.every((l) => d.words[l].style === d.words.te.style);
  const setAllStyle = (x: SpeakStyle) => touch({ ...d, words: Object.fromEntries(SPEAK_LANGS.map((l) => [l, { ...d.words[l], style: x }])) as Draft["words"] }); // the single choice writes the same value to every language (the contract stays per language)
  const setWord = (l: SpeakLang, patch: Partial<Draft["words"][SpeakLang]>) => touch({ ...d, words: { ...d.words, [l]: { ...d.words[l], ...patch } } });
  const save = () => {
    if (!change || introBad) return;
    start(async () => {
      const out = await panel.save(change);
      if (out.ok) {
        setState(out.data);
        setD(draftOf(out.data));
        setMsg({ ok: true });
      } else setMsg({ ok: false, error: out.error });
    });
  };
  const exampleStyle: SpeakStyle = d.words[exLang === "en" ? "te" : (exLang as SpeakLang)]?.style ?? "everyday_mixed";
  const example = (who: "tone" | "words" | "region") =>
    hear === who ? (
      <div className="mt-2 rounded-lg bg-surface-2 p-3" data-part={`sp-example-${who}`}>
        <div role="group" aria-label={t("sp.hear.lang")} className="flex flex-wrap gap-2">
          {EXAMPLE_LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={l === exLang} onClick={() => setExLang(l)} className={chip(l === exLang)}>
              {langNames[l]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-base" lang={exLang} aria-live="polite" data-part="sp-line">
          <span className="sr-only">{t("sp.hear.line")}: </span>
          {exampleLine(d.tone, exampleStyle, exLang, business)}
        </p>
        <p className={fieldHelp}>{t("sp.hear.draft")}</p>
      </div>
    ) : null;
  const hearButton = (who: "tone" | "words" | "region") => (
    <button type="button" className={hearBtn} aria-expanded={hear === who} onClick={() => setHear(hear === who ? null : who)} data-part={`sp-hear-${who}`}>
      {t("sp.hear")}
    </button>
  );
  const toneNote = state.tone.source === "migrated" ? t("sp.tone.migrated") : state.tone.source === "pack_default" ? t("sp.tone.pack", { tone: t(`sp.tone.${state.tone.packDefault}`) }) : null;
  const errText = msg && !msg.ok ? (t(`sp.err.${msg.error}`) !== `sp.err.${msg.error}` ? t(`sp.err.${msg.error}`) : msg.error === "introduce" ? t("tt.err.introduce_as") : t("sp.err.rejected")) : null;
  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface-2/40 p-4" aria-labelledby="sp-h" data-part="sp-panel">
      <div>
        <h3 id="sp-h" className="font-display text-lg font-semibold">
          {t("sp.title")}
        </h3>
        <p className={fieldHelp}>{t("sp.sub")}</p>
        {panel.demo ? (
          <p className={`${noteBox} m-0 mt-2`} data-part="sp-notsaved">
            {t("sp.notsaved")}
          </p>
        ) : null}
      </div>

      <fieldset data-part="sp-tone">
        <legend className={h3}>{t("sp.tone")}</legend>
        <div className="mt-1 flex flex-col">
          {TONES.map((x) => (
            <label key={x} className={checkRow}>
              <input type="radio" name="sp-tone" value={x} checked={d.tone === x} disabled={off} onChange={() => touch({ ...d, tone: x })} className="size-5 shrink-0 accent-brand-text" />
              <span>
                {t(`sp.tone.${x}`)}
                <span className={`${fieldHelp} block`}>{t(`sp.tone.${x}.help`)}</span>
              </span>
            </label>
          ))}
        </div>
        {toneNote ? (
          <p className={fieldHelp} data-part="sp-tone-source">
            {toneNote}
          </p>
        ) : null}
        <p className={fieldHelp}>{t("sp.tone.note")}</p>
        {hearButton("tone")}
        {example("tone")}
      </fieldset>

      <fieldset data-part="sp-words">
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
                  <input type="radio" name={`sp-words-${wordsLang}`} value={x} checked={isWordStyle(wordsLang, x)} disabled={off} onChange={() => setWordStyle(wordsLang, x)} className="size-5 shrink-0 accent-brand-text" />
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
                  <input type="radio" name="sp-words-all" value={x} checked={allSame && isWordStyle("te", x)} disabled={off} onChange={() => setAllStyle(x)} className="size-5 shrink-0 accent-brand-text" />
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
        {hearButton("words")}
        {example("words")}
      </fieldset>

      <fieldset data-part="sp-region">
        <legend className={h3}>{t("sp.region")}</legend>
        <p className={fieldHelp}>{t("sp.region.help")}</p>
        <div role="group" aria-label={t("sp.region")} className="mt-2 flex flex-wrap gap-2">
          {REGION_LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={l === regionLang} onClick={() => setRegionLang(l)} className={chip(l === regionLang)}>
              {langNames[l]}
              {d.words[l].region !== "neutral" ? <span aria-hidden="true"> ·</span> : null}
            </button>
          ))}
        </div>
        <div className="mt-1 flex flex-col">
          {REGIONS[regionLang].map((r) => (
            <label key={r} className={checkRow}>
              <input type="radio" name={`sp-region-${regionLang}`} value={r} checked={d.words[regionLang].region === r} disabled={off} onChange={() => setWord(regionLang, { region: r })} className="size-5 shrink-0 accent-brand-text" />
              {t(regionKey(regionLang, r))}
            </label>
          ))}
        </div>
        {hearButton("region")}
        {example("region")}
      </fieldset>

      <IntroduceAsField t={t} value={d.introduceAs} off={off} business={business} ownerName={state.introduceAs.ownerName} onChange={(introduceAs) => touch({ ...d, introduceAs })} />

      {off ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnMain} disabled={busy || change === null || introBad !== null} onClick={save} data-part="sp-save">
            {busy ? t("sp.saving") : t("sp.save")}
          </button>
        </div>
      )}
      {msg?.ok ? (
        <p role="status" className={okBox}>
          {t("sp.saved")}
        </p>
      ) : null}
      {errText ? (
        <p role="alert" className={alertBox}>
          {errText}
          {msg && !msg.ok && msg.error === "mfa" ? (
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
