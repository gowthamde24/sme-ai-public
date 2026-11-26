"use client";

import { List, PhoneIncoming, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { Reply } from "@/components/v2/app/cc/kit";
import { JOB_NAME_MAX, KIND_KEYS, TELL_KINDS, TELL_LANGS, TELL_MODES, TELL_TEXT_MAX, TELL_TEXT_MIN, optionsOf, settingsPatch, startValues, stillUnclear, type TellDraft, type TellLang, type TellMode } from "@/lib/jobs/tell";
import type { JobKind } from "@/lib/jobs/types";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../../ui";
import { VoiceMic } from "../../voice-input/LazyVoiceMic";
import { makeT, type Say, type Words } from "../../words";
import { fmtHhmm, HOUR_KEYS } from "@/lib/jobs/detail";

/**
 * "Tell your assistant what to do" (TELL_SCREENS; owner 29 Nov 2026; mock "Tell your assistant what to do"). Step 1: a box with a rotating example (English and Telugu), the microphone (the app's own voice typing: it puts the words in the box and sends nothing),
 * a language, three boxed choices (what it is for), Continue and "Start from a template". Step 2: the DRAFT as plain labelled fields (label above, no sentence forms), the ones the assistant could not tell marked, one neutral line "Nothing is switched on yet",
 * and "Looks right? Turn it on" / Change / Cancel. Only "Turn it on" begins a job. Every refusal is one plain sentence in our words (the actions turn the API's closed codes into `jobs.tell.err.*`).
 */
export type TellActions = {
  describe: (input: { text: string; language: TellLang; mode: TellMode | null }) => Promise<Reply<TellDraft>>;
  turnOn: (input: { kind: JobKind; name: string; settings: Record<string, string | boolean> }) => Promise<Reply<{ jobId: string | null; waiting: boolean; saved: boolean }>>;
};

const EXAMPLES = ["jobs.tell.ph.1", "jobs.tell.ph.2", "jobs.tell.ph.3"] as const;
const MODE_ICON = { enquiry: Zap, list: List, incoming: PhoneIncoming } as const;
const MODE_TONE = { enquiry: "call", list: "chat", incoming: "visit" } as const;
/** The language names in their own scripts (never translated). */
const LANG_NAME: Record<Exclude<TellLang, "any">, string> = { en: "English", te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ" };

function optionText(t: Say, key: string, value: string): string {
  if (HOUR_KEYS.includes(key)) return fmtHhmm(value);
  const k = `jobs.opt.${key}.${value}`;
  const s = t(k);
  return s === k ? value : s;
}
function labelOf(t: Say, kind: JobKind | null, key: string): string {
  const own = kind ? `jobs.f.${kind}.${key}` : "";
  if (own && t(own) !== own) return t(own);
  const k = `jobs.f.${key}`;
  const s = t(k);
  return s === k ? key.replace(/_/g, " ") : s;
}

/** A labelled choice: the label above, a native select. `unclear` marks one the assistant could not tell (a dot and a short line; it must be chosen before the job is turned on). */
function Choice({ id, label, value, options, onChange, unclear, t, disabled }: { id: string; label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void; unclear: boolean; t: Say; disabled: boolean }) {
  return (
    <div className="flex min-w-0 flex-col" data-field={id} data-unclear={unclear ? "" : undefined}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <select id={id} value={value} disabled={disabled} aria-invalid={unclear || undefined} aria-describedby={unclear ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.value)} className={`${fieldInput} ${unclear ? "border-brand-edge bg-brand-bg" : ""}`}>
        <option value="" disabled={unclear}>
          {unclear ? t("jobs.tell.tbd") : t("jobs.tell.usual")}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {unclear ? (
        <p id={`${id}-hint`} className="m-0 mt-1.5 flex items-start gap-2 text-sm text-ink">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-brand-text" />
          {t("jobs.tell.tbd.hint")}
        </p>
      ) : null}
    </div>
  );
}

function Fixed({ label, children, part }: { label: string; children: React.ReactNode; part: string }) {
  return (
    <div className="flex min-w-0 flex-col" data-field={part}>
      <span className={fieldLabel}>{label}</span>
      <p className="m-0 min-h-12 break-words rounded-lg border border-line px-3 py-3 text-base text-ink">{children}</p>
    </div>
  );
}

export function TellAssistant({ words, base, actions }: { words: Words; base: string; actions: TellActions }) {
  const t = makeT(words);
  const router = useRouter();
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const draftRef = React.useRef<HTMLHeadingElement>(null);
  const [text, setText] = React.useState("");
  const [lang, setLang] = React.useState<TellLang>("any");
  const [mode, setMode] = React.useState<TellMode | null>("enquiry");
  const [example, setExample] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<TellDraft | null>(null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);

  // the example in the empty box changes every few seconds (English, English, Telugu); a box with words in it keeps still
  React.useEffect(() => {
    if (text !== "" || draft) return;
    const id = setInterval(() => setExample((n) => (n + 1) % EXAMPLES.length), 4500);
    return () => clearInterval(id);
  }, [text, draft]);

  async function read() {
    const said = text.trim();
    if (said.length < TELL_TEXT_MIN || said.length > TELL_TEXT_MAX) {
      setError(t("jobs.tell.err.text"));
      return;
    }
    setError(null);
    setBusy(true);
    const r = await actions.describe({ text: said, language: lang, mode });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (!r.data.understood || !r.data.kind || !TELL_KINDS.includes(r.data.kind)) {
      setDraft(null);
      setError(t("jobs.tell.err.nomatch"));
      return;
    }
    const own = t(`jobs.kind.${r.data.kind}`);
    setDraft(r.data);
    setValues(startValues(r.data));
    setName(own.length <= JOB_NAME_MAX ? own : "");
    setNote(null);
    requestAnimationFrame(() => draftRef.current?.focus());
  }

  async function turnOn() {
    if (!draft?.kind) return;
    setBusy(true);
    setError(null);
    const r = await actions.turnOn({ kind: draft.kind, name: name.trim(), settings: settingsPatch(draft.kind, values) });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (r.data.waiting) {
      setNote(t("jobs.tell.waiting"));
      return;
    }
    router.push(`${base}/jobs/${r.data.jobId}?started=1`);
  }

  const kind = draft?.kind ?? null;
  const open = draft && kind ? stillUnclear(draft, values) : [];
  const keys = kind ? KIND_KEYS[kind] : [];
  const choice = (key: string) => {
    const opts = kind ? optionsOf(kind, key) : null;
    if (!kind || opts === null || !keys.includes(key)) return null;
    const list = opts === "toggle" ? [{ value: "on", label: t("jobs.tell.yes") }, { value: "off", label: t("jobs.tell.no") }] : opts.map((o) => ({ value: o, label: optionText(t, key, o) }));
    return <Choice key={key} id={`tell-${key}`} label={labelOf(t, kind, key)} value={values[key] ?? ""} options={list} unclear={open.includes(key)} t={t} disabled={busy} onChange={(v) => setValues((s) => ({ ...s, [key]: v }))} />;
  };

  if (draft && kind) {
    const rest = keys.filter((k) => !["when", "language"].includes(k));
    return (
      <div data-part="tell-draft" className="flex max-w-3xl flex-col gap-5">
        <p data-part="tell-nothing" className="m-0 flex items-start gap-3 border-y border-line py-4 text-[15px] text-muted">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-muted" />
          {t("jobs.tell.nothing")}
        </p>
        <h2 ref={draftRef} tabIndex={-1} className="m-0 font-display text-xl font-bold text-ink outline-none">
          {t("jobs.tell.draft.title")}
        </h2>
        {draft.unclear.length > 0 && open.length > 0 ? (
          <p data-part="tell-unclear" role="status" className="m-0 text-[15px] text-ink">
            {t("jobs.tell.unclear", { list: open.map((k) => labelOf(t, kind, k).toLowerCase()).join(", ") })}
          </p>
        ) : null}
        <div className="flex flex-col">
          <label htmlFor="tell-name" className={fieldLabel}>
            {t("jobs.tell.f.name")}
          </label>
          <input id="tell-name" type="text" maxLength={JOB_NAME_MAX} value={name} disabled={busy} placeholder={t(`jobs.kind.${kind}`)} onChange={(e) => setName(e.target.value)} className={fieldInput} />
        </div>
        <div className="grid grid-cols-1 gap-5 min-[560px]:grid-cols-2">
          <Fixed label={t("jobs.tell.f.who")} part="who">
            {t(`jobs.tell.who.${kind}`)}
          </Fixed>
          {keys.includes("when") ? choice("when") : <Fixed label={t("jobs.tell.f.when")} part="when">{t("jobs.tell.when.default")}</Fixed>}
          <Fixed label={t("jobs.tell.f.does")} part="does">
            {t(`jobs.tell.does.${kind}`)}
          </Fixed>
          {keys.includes("language") ? choice("language") : <Fixed label={t("jobs.tell.f.language")} part="language">{t("jobs.tell.language.default")}</Fixed>}
        </div>
        <Fixed label={t("jobs.tell.f.asks")} part="asks">
          {t(`jobs.tell.asks.${kind}`)}
        </Fixed>
        {rest.length > 0 ? <div className="grid grid-cols-1 gap-5 min-[560px]:grid-cols-2">{rest.map(choice)}</div> : null}
        {error ? (
          <p role="alert" data-part="tell-error" className="m-0 text-[15px] text-red-text">
            {error}
          </p>
        ) : null}
        {note ? (
          <p role="status" data-part="tell-note" className="m-0 flex items-start gap-3 text-[15px] text-ink">
            <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-brand-text" />
            {note}
          </p>
        ) : null}
        {open.length > 0 ? <p className="m-0 text-sm text-muted">{t("jobs.tell.choose_first")}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-part="turn-on" disabled={busy || open.length > 0 || note !== null} onClick={() => void turnOn()} className={btnMain}>
            {busy ? t("jobs.tell.turning") : t("jobs.tell.on")}
          </button>
          <button
            type="button"
            data-part="tell-change"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setNote(null);
              requestAnimationFrame(() => boxRef.current?.focus());
            }}
            className={btnQuiet}
          >
            {t("jobs.tell.change")}
          </button>
          <Link href={`${base}/jobs`} prefetch={false} className="inline-flex min-h-11 items-center px-2 text-base font-semibold text-ink underline underline-offset-4">
            {t("jobs.tell.cancel")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div data-part="tell" className="flex max-w-3xl flex-col gap-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void read();
        }}
        className="flex flex-col"
      >
        <div className="rounded-xl border border-line bg-surface p-3 sm:p-4">
          <label htmlFor="tell-say" className="sr-only">
            {t("jobs.tell.label")}
          </label>
          <textarea
            ref={boxRef}
            id="tell-say"
            name="tell-say"
            rows={3}
            maxLength={TELL_TEXT_MAX}
            value={text}
            disabled={busy}
            data-voice="allow"
            placeholder={t(EXAMPLES[example])}
            onChange={(e) => setText(e.target.value)}
            className="block min-h-[92px] w-full resize-y border-0 bg-transparent p-0 text-lg text-ink outline-none placeholder:text-muted"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <VoiceMic target={boxRef} size="icon" />
            <select aria-label={t("jobs.tell.lang")} value={lang} disabled={busy} onChange={(e) => setLang(e.target.value as TellLang)} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-[15px] text-ink">
              {TELL_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l === "any" ? t("jobs.tell.lang.any") : LANG_NAME[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <h2 className="m-0 mb-2 mt-6 text-[15px] font-semibold text-muted">{t("jobs.tell.mode.title")}</h2>
        <div role="radiogroup" aria-label={t("jobs.tell.mode.title")} className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-3">
          {TELL_MODES.map((m) => {
            const Icon = MODE_ICON[m];
            const on = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                data-mode={m}
                disabled={busy}
                onClick={() => setMode(m)}
                className={`flex min-h-24 min-w-0 flex-col items-start gap-1 rounded-xl border bg-surface p-4 text-left ${on ? "border-ink ring-1 ring-ink" : "border-line"}`}
              >
                <Icon data-k={MODE_TONE[m]} aria-hidden="true" className="size-6" strokeWidth={1.8} />
                <b className="text-base font-semibold text-ink">{t(`jobs.tell.mode.${m}.t`)}</b>
                <span className="text-sm text-muted">{t(`jobs.tell.mode.${m}.d`)}</span>
              </button>
            );
          })}
        </div>
        {error ? (
          <p role="alert" data-part="tell-error" className="m-0 mt-4 text-[15px] text-red-text">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="m-0 mt-4 text-sm text-muted">
            {t("jobs.tell.reading")}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button type="submit" data-part="tell-go" disabled={busy} className={btnMain}>
            {t("jobs.tell.go")}
          </button>
          <Link href={`${base}/jobs?new=1`} prefetch={false} className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline underline-offset-4">
            {t("jobs.tell.template")}
          </Link>
        </div>
      </form>
    </div>
  );
}
