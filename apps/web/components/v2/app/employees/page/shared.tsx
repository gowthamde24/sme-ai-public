"use client";

import Link from "next/link";
import * as React from "react";

import type { EmployeePreview } from "@/lib/api/employees";
import type { ActivityCall, Done, Employee, EmployeePatch, Refusal } from "@/lib/employees/types";

import { alertBox, btnMain, fieldHelp, fieldInput, fieldLabel, surfaceFlat } from "../../ui";
import { makeT, type Words } from "../../words";

/** The moves of the page, each already bound to this workspace and this employee (server actions in the page, mocks in the tests). */
export type PageActions = {
  patch: (patch: EmployeePatch) => Promise<Done<Employee>>;
  setStatus: (status: "on" | "paused" | "archived") => Promise<Done<Employee>>;
  setVoice: (language: string, voiceCode: string) => Promise<Done<Employee>>;
  setPhone: (phoneNumberId: string | null) => Promise<Done<Employee>>;
  preview: (input: { language: string; text?: string }) => Promise<Done<EmployeePreview>>;
  activity: (before?: string) => Promise<Done<ActivityCall[]>>;
};
/** What every tab gets. `canEdit` = Owner or Admin; everybody else reads. */
export type TabProps = { emp: Employee; words: Words; canEdit: boolean; actions: PageActions; onChange: (e: Employee) => void; base: string };
export type CatalogueVoice = { id: string; name: string; language: string; gender: "female" | "male"; recommended: boolean };
export type LineChoice = { id: string; display: string };

/** The state of one Save: busy, "Saved", or the closed refusal. A thrown error is the plain "could not do that" sentence. */
export function useSave(onChange: (e: Employee) => void) {
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<Refusal | null>(null);
  const run = async (move: () => Promise<Done<Employee>>): Promise<boolean> => {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const out = await move();
      if (out.ok) {
        onChange(out.data);
        setSaved(true);
      } else setError(out.error);
      return out.ok;
    } catch {
      setError("unavailable");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const fail = (e: Refusal) => {
    setSaved(false);
    setError(e);
  };
  const clear = () => {
    setSaved(false);
    setError(null);
  };
  return { busy, saved, error, run, fail, clear };
}
export type SaveState = ReturnType<typeof useSave>;

/** The Save button of a card with its plain "Saved" or its refusal sentence. */
export function SaveBar({ words, state, onSave, disabled, label }: { words: Words; state: SaveState; onSave: () => void; disabled?: boolean; label?: string }) {
  const t = makeT(words);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onSave} disabled={disabled || state.busy} data-part="emp-save" className={btnMain}>
          {label ?? t("emp.page.save")}
        </button>
        <span role="status" aria-live="polite" data-part="emp-saved" className="text-[15px] font-semibold text-green-text">
          {state.saved ? t("emp.page.saved") : ""}
        </span>
      </div>
      {state.error ? (
        <p role="alert" data-part="emp-error" className={`${alertBox} m-0`}>
          {t(`emp.err.${state.error}`)}
        </p>
      ) : null}
    </div>
  );
}

/** A flat box with a heading and an optional plain line. */
export function Card({ title, desc, children, id }: { title: string; desc?: string; children: React.ReactNode; id?: string }) {
  const h = React.useId();
  return (
    <section aria-labelledby={h} id={id} className={`${surfaceFlat} flex flex-col gap-4`}>
      <div>
        <h2 id={h} className="m-0 font-display text-lg font-bold leading-snug text-ink">
          {title}
        </h2>
        {desc ? <p className="m-0 mt-1 text-[15px] text-muted">{desc}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One plain labelled text box (no fill-in-the-blank sentences). */
export function TextField({ label, help, value, onChange, disabled, max, id, inputMode }: { label: string; help?: string; value: string; onChange: (v: string) => void; disabled?: boolean; max?: number; id: string; inputMode?: "numeric" | "text" }) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <input id={id} type="text" inputMode={inputMode} value={value} maxLength={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-describedby={help ? `${id}-help` : undefined} className={fieldInput} />
      {help ? (
        <p id={`${id}-help`} className={fieldHelp}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** The sentence and the link on every part of the main assistant that is set in My assistant. */
export function DefaultNote({ words, base }: { words: Words; base: string }) {
  const t = makeT(words);
  return (
    <p data-part="emp-default-note" className="m-0 rounded-xl border border-line bg-surface-2 p-3 text-[15px] text-ink">
      {t("emp.page.default_note")}{" "}
      <Link href={`${base}/my-assistant`} prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-brand-text underline underline-offset-2">
        {t("emp.page.default_link")}
      </Link>
    </p>
  );
}

/** The patch of what changed: a key is there only when the value is not the saved one. */
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
