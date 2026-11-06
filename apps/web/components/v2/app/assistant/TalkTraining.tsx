"use client";

import * as React from "react";

import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { ADDRESSES, LIMITS, type Pair, type TalkError, type TalkTraining as Doc, type TalkTrainingState } from "@/lib/talk-training/types";

import { alertBox, btnMain, btnQuiet, checkRow, fieldHelp, fieldInput, fieldLabel, fieldTextarea, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

type Out = { ok: true; data: TalkTrainingState } | { ok: false; error: TalkError };
export type TalkTrainingActions = { save: (input: unknown) => Promise<Out>; reset: () => Promise<Out> };
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
const h3 = "text-base font-semibold text-ink";

/**
 * Settings > AI assistant > "How I talk to customers" (calls-like-a-pro part 3, C1's docs/contracts/talk-training.md). The Owner teaches the assistant: the greeting per language, how to address people (never "sir / madam" unless chosen), the
 * questions to ask one at a time, the words it must never say (checked by code before every line it speaks), answers to objections and a few good examples. The platform's own rules are listed read-only. One Save sends the whole document;
 * "Use the suggested ones" goes back to the defaults. Both need the Owner's second factor (the screen says so). An Admin reads it. What is shown after a save is what the API answered.
 */
export function TalkTraining({ words, initial, langNames, canEdit, securityHref, actions }: { words?: Words; initial: TalkTrainingState; langNames: Record<CallLang, string>; canEdit: boolean; securityHref: string; actions: TalkTrainingActions }) {
  const t = makeT(words);
  const [state, setState] = React.useState(initial);
  const [doc, setDoc] = React.useState<Doc>(initial.training);
  const [lang, setLang] = React.useState<CallLang>(CALL_LANGS.find((l) => initial.training.greeting[l] !== undefined) ?? "te");
  const [dirty, setDirty] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [busy, start] = React.useTransition();
  const [message, setMessage] = React.useState<{ ok: true; key: "tt.saved" | "tt.reset.done" } | { ok: false; error: TalkError } | null>(null);

  const change = (next: Partial<Doc>) => {
    setDoc((d) => ({ ...d, ...next }));
    setDirty(true);
    setMessage(null);
  };
  const answered = (out: Out, key: "tt.saved" | "tt.reset.done") => {
    if (!out.ok) return setMessage({ ok: false, error: out.error });
    setState(out.data);
    setDoc(out.data.training);
    setDirty(false);
    setConfirmReset(false);
    setMessage({ ok: true, key });
  };
  const save = () => start(async () => answered(await actions.save(doc), "tt.saved"));
  const reset = () => start(async () => answered(await actions.reset(), "tt.reset.done"));
  const off = !canEdit || busy;

  return (
    <section className={`${surface} flex flex-col gap-5`} aria-labelledby="tt-h" data-part="talk-training">
      <div>
        <h2 id="tt-h" className="font-display text-xl font-semibold">
          {t("tt.title")}
        </h2>
        <p className={fieldHelp}>{t("tt.sub")}</p>
        {state.saved ? null : <p className={fieldHelp} data-part="tt-defaults">{t("tt.defaults")}</p>}
        {canEdit ? null : <p className={fieldHelp}>{t("tt.owneronly")}</p>}
      </div>

      <div data-part="tt-greeting">
        <p className={h3}>{t("tt.greeting")}</p>
        <div role="group" aria-label={t("tt.greeting.lang")} className="mt-2 flex flex-wrap gap-2">
          {CALL_LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={l === lang} onClick={() => setLang(l)} className={chip(l === lang)}>
              {langNames[l]}
              {doc.greeting[l] !== undefined ? <span aria-hidden="true"> ·</span> : null}
            </button>
          ))}
        </div>
        <label htmlFor="tt-greeting" className="sr-only">
          {t("tt.greeting")}
        </label>
        <textarea
          id="tt-greeting"
          lang={lang}
          rows={2}
          maxLength={LIMITS.greeting.max}
          value={doc.greeting[lang] ?? ""}
          placeholder={state.defaults.greeting[lang] ?? ""}
          disabled={off}
          onChange={(e) => {
            const greeting = { ...doc.greeting };
            if (e.target.value === "") delete greeting[lang];
            else greeting[lang] = e.target.value;
            change({ greeting });
          }}
          className={`${fieldTextarea} mt-3`}
        />
        <p className={fieldHelp}>{t("tt.greeting.help")}</p>
      </div>

      <fieldset data-part="tt-address">
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

      <List id="questions" t={t} items={doc.questions} max={LIMITS.question.count} length={LIMITS.question.max} off={off} onChange={(questions) => change({ questions })} numbered />
      <List id="never" t={t} items={doc.neverSay} max={LIMITS.neverSay.count} length={LIMITS.neverSay.max} off={off} onChange={(neverSay) => change({ neverSay })} />
      <Pairs id="objections" t={t} items={doc.objections} max={LIMITS.objection.count} length={LIMITS.objection.max} off={off} onChange={(objections) => change({ objections })} />
      <Pairs id="examples" t={t} items={doc.examples} max={LIMITS.example.count} length={LIMITS.example.max} off={off} onChange={(examples) => change({ examples })} />

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

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy || !dirty} className={btnMain}>
            {busy ? t("tt.saving") : t("tt.save")}
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
          ) : state.saved ? (
            <button type="button" onClick={() => setConfirmReset(true)} disabled={busy} className={btnQuiet}>
              {t("tt.reset")}
            </button>
          ) : null}
        </div>
      ) : null}
      {message?.ok ? (
        <p role="status" className={okBox}>
          {t(message.key)}
        </p>
      ) : null}
      {message && !message.ok ? (
        <p role="alert" className={alertBox}>
          {t(`tt.err.${message.error}` as "tt.err.down")}
          {message.error === "mfa" ? (
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

type T = ReturnType<typeof makeT>;

/** A short list of lines (the questions, in order; the words never to say): a box per line, Remove, and Add while there is room. */
function List({ id, t, items, max, length, off, onChange, numbered = false }: { id: "questions" | "never"; t: T; items: string[]; max: number; length: number; off: boolean; onChange: (next: string[]) => void; numbered?: boolean }) {
  const Tag = numbered ? "ol" : "ul";
  return (
    <div data-part={`tt-${id}`}>
      <p className={h3} id={`tt-${id}-h`}>
        {t(`tt.${id}` as "tt.questions")}
      </p>
      <p className={fieldHelp}>{t(`tt.${id}.help` as "tt.questions.help", { n: max })}</p>
      <Tag className="mt-2 flex flex-col gap-2" aria-labelledby={`tt-${id}-h`}>
        {items.map((v, i) => (
          <li key={i} className="flex items-center gap-2">
            {numbered ? <span className="w-5 shrink-0 text-right text-sm text-muted">{i + 1}.</span> : null}
            <input aria-label={t(`tt.${id}.one` as "tt.questions.one", { n: i + 1 })} value={v} maxLength={length} disabled={off} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} className={fieldInput} />
            {off ? null : (
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className={btnQuiet} aria-label={t("tt.remove.n", { n: i + 1 })}>
                {t("tt.remove")}
              </button>
            )}
          </li>
        ))}
      </Tag>
      {off || items.length >= max ? null : (
        <button type="button" onClick={() => onChange([...items, ""])} className={`${btnQuiet} mt-2`}>
          {t(`tt.${id}.add` as "tt.questions.add")}
        </button>
      )}
    </div>
  );
}

/** Pairs of lines: what the customer says and the answer (objections), or the customer's line and the Owner's good answer (examples). */
function Pairs({ id, t, items, max, length, off, onChange }: { id: "objections" | "examples"; t: T; items: Pair[]; max: number; length: number; off: boolean; onChange: (next: Pair[]) => void }) {
  const set = (i: number, key: "a" | "b", v: string) => onChange(items.map((p, j) => (j === i ? { ...p, [key]: v } : p)));
  return (
    <div data-part={`tt-${id}`}>
      <p className={h3}>{t(`tt.${id}` as "tt.objections")}</p>
      <p className={fieldHelp}>{t(`tt.${id}.help` as "tt.objections.help", { n: max })}</p>
      <ul className="mt-2 flex flex-col gap-3">
        {items.map((p, i) => (
          <li key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>{t(`tt.${id}.a` as "tt.objections.a")}</span>
              <input value={p.a} maxLength={length} disabled={off} onChange={(e) => set(i, "a", e.target.value)} className={fieldInput} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t(`tt.${id}.b` as "tt.objections.b")}</span>
              <textarea rows={2} value={p.b} maxLength={length} disabled={off} onChange={(e) => set(i, "b", e.target.value)} className={fieldTextarea} />
            </label>
            {off ? null : (
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className={`${btnQuiet} justify-self-start`} aria-label={t("tt.remove.n", { n: i + 1 })}>
                {t("tt.remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {off || items.length >= max ? null : (
        <button type="button" onClick={() => onChange([...items, { a: "", b: "" }])} className={`${btnQuiet} mt-2`}>
          {t(`tt.${id}.add` as "tt.objections.add")}
        </button>
      )}
    </div>
  );
}
