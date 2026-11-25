"use client";

import * as React from "react";

import type { Fail, Ok } from "@/lib/api/commerce-notify";

import { copyToClipboard } from "../lead-desk/CopyBox";
import { btnQuiet, fieldInput, fieldLabel, fieldMono } from "../ui";
import { makeT, type Say, type Words } from "../words";

export const when = (iso: string): string => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** The words of a refusal: the closed reason when the API gave one, else the closed kind of failure. Never the vendor's or the API's own text. */
export function failText(t: Say, f: Fail): string {
  return f.reason ? t(`cn.reason.${f.reason}`) : t(`cn.fail.${f.error}`);
}

/** Runs one move: busy while it goes, the refusal as one plain sentence, a note when it worked. Keys typed into a card are cleared by the caller the moment it sends them. */
export function useRunner(t: Say) {
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const run = async <T,>(go: () => Promise<Ok<T>>, done: (r: { ok: true } & T) => void): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    setNote(null);
    let r: Ok<T>;
    try {
      r = await go();
    } catch {
      setBusy(false);
      setProblem(t("cn.fail.other"));
      return false;
    }
    setBusy(false);
    if (r.ok) {
      done(r);
      return true;
    }
    setProblem(failText(t, r));
    return false;
  };
  return { busy, problem, note, setNote, setProblem, run };
}

export type Tone = "plain" | "brand";
/** A neutral notice: a dot and one sentence, never an alarm box. */
export function Notice({ tone = "plain", role = "note", children }: { tone?: Tone; role?: "note" | "status" | "alert"; children: React.ReactNode }) {
  return (
    <p role={role} className={`m-0 flex items-start gap-2 text-[15px] ${tone === "brand" ? "font-semibold text-ink" : "text-muted"}`}>
      <span aria-hidden="true" className={`mt-2 size-2 shrink-0 rounded-full ${tone === "brand" ? "bg-brand" : "bg-muted"}`} />
      <span>{children}</span>
    </p>
  );
}

/** The boxed card of a thing you connect: its name, its state (a dot and one sentence) and, opened, its panel. */
export function CardBox({ id, group, title, state, stateText, open, onToggle, openWord, closeWord, children }: { id: string; group: string; title: string; state: "connected" | "not_connected" | "needs_setup" | "problem"; stateText: string; open: boolean; onToggle: () => void; openWord: string; closeWord: string; children: React.ReactNode }) {
  const dot = state === "problem" ? "bg-brand" : state === "connected" ? "bg-green-text" : "bg-muted";
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-part="commerce-card" data-group={group} data-id={id} data-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 lang="en" className="m-0 text-[17px] font-semibold text-ink">
            {title}
          </h3>
          <p className="m-0 mt-1 flex items-center gap-2 text-[14px] text-muted" data-part="card-state">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
            {stateText}
          </p>
        </div>
        <button type="button" className={btnQuiet} aria-expanded={open} onClick={onToggle}>
          {open ? closeWord : openWord}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-4 border-t border-line pt-4" data-part="card-panel">
          {children}
        </div>
      ) : null}
    </li>
  );
}

/** A plain labelled field: the label above, the input, one grey hint line. A secret is a password field and is emptied by its owner the moment it is sent. */
export function TextField({ id, label, hint, value, onChange, secret = false, lang, placeholder, max = 300 }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; secret?: boolean; lang?: string; placeholder?: string; max?: number }) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} lang={lang} className={fieldLabel}>
        {label}
      </label>
      <input id={id} type={secret ? "password" : "text"} lang={lang} autoComplete="off" spellCheck={false} maxLength={max} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={fieldInput} />
      {hint ? (
        <span lang={lang} className="mt-1 text-[14px] text-muted">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function CheckField({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 py-1 text-[15px] text-ink">
        <input id={id} type="checkbox" className="size-5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint ? <span className="ml-8 text-[14px] text-muted">{hint}</span> : null}
    </div>
  );
}

export function SelectField({ id, label, hint, value, onChange, options }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <select id={id} className={fieldInput} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <span className="mt-1 text-[14px] text-muted">{hint}</span> : null}
    </div>
  );
}

/** A read-only box with a Copy button. Used for the address and the secret the API shows ONCE after a connect: they live in the props of this box only, and the owner closes it with "I have copied it". */
export function CopyField({ words, id, label, value, multiline = false, lang }: { words: Words; id: string; label: string; value: string; multiline?: boolean; lang?: string }) {
  const t = makeT(words);
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-60">
          {multiline ? <textarea id={id} readOnly lang={lang} rows={Math.min(12, value.split("\n").length + 1)} value={value} className={fieldMono} onFocus={(e) => e.currentTarget.select()} /> : <input id={id} readOnly lang={lang} value={value} className={fieldMono} onFocus={(e) => e.currentTarget.select()} />}
        </div>
        <button type="button" className={btnQuiet} onClick={async () => setState((await copyToClipboard(value)) ? "copied" : "failed")}>
          {state === "copied" ? t("cn.copied") : t("cn.copy")}
        </button>
      </div>
      {state === "failed" ? (
        <p role="alert" className="mt-1.5 text-sm text-ink">
          {t("cn.copy.failed")}
        </p>
      ) : null}
    </div>
  );
}

/** The two lines under a card's Test: the result in one sentence. */
export function Result({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p role="status" className="m-0 flex items-start gap-2 text-[15px] text-ink" data-part="card-result">
      <span aria-hidden="true" className={`mt-2 size-2 shrink-0 rounded-full ${ok ? "bg-green-text" : "bg-brand"}`} />
      <span>{text}</span>
    </p>
  );
}

export function Disconnect({ words, name, busy, onYes }: { words: Words; name: string; busy: boolean; onYes: () => void }) {
  const t = makeT(words);
  const [ask, setAsk] = React.useState(false);
  return ask ? (
    <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-muted" data-part="card-disconnect">
      {t("cn.disconnect.ask", { name })}
      <button type="button" disabled={busy} className={btnQuiet} onClick={onYes}>
        {t("cn.disconnect.yes")}
      </button>
      <button type="button" className={btnQuiet} onClick={() => setAsk(false)}>
        {t("cn.cancel")}
      </button>
    </p>
  ) : (
    <div>
      <button type="button" className={btnQuiet} onClick={() => setAsk(true)}>
        {t("cn.disconnect")}
      </button>
    </div>
  );
}
