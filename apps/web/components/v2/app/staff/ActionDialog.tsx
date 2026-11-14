"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { NOTE_MAX, REASONS, wordsProblem } from "@/lib/staff/reasons";
import { TEXT } from "@/lib/staff/words";

/**
 * The reason box of every action that changes or reveals something (pause / resume an assistant, unmask names and numbers, goodwill credit's reason step): a reason is chosen (no default) and words are ALWAYS asked for (3 to 300 characters;
 * the API logs them and the shop owner sees them). `onSubmit` returns the plain sentence to show when it failed, or null when it worked (the caller then closes and refreshes). Esc and Cancel close it. A staff session that ended (401) is the
 * caller's: it goes to its own page before the sentence is built.
 */
export function ActionDialog({
  title,
  intro,
  noteLabel,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  intro: string;
  noteLabel: string;
  submitLabel: string;
  onSubmit: (code: string, note: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = wordsProblem(code, note);
    if (problem) {
      setError(problem === "choose" ? TEXT.reasonChoose : TEXT.reasonSayWhat);
      return;
    }
    setError(null);
    start(async () => {
      const message = await onSubmit(code, note.trim());
      if (message) setError(message);
    });
  }

  return (
    <div className="sc-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sc-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onSubmit={submit} noValidate data-part="action-dialog">
        <h2 id={`${id}-t`}>{title}</h2>
        <p>{intro}</p>
        <fieldset>
          <legend>{TEXT.reasonLegend}</legend>
          {REASONS.map((r, i) => (
            <label key={r.code} className="sc-radio">
              <input ref={i === 0 ? first : undefined} type="radio" name={`${id}-reason`} value={r.code} checked={code === r.code} onChange={() => { setCode(r.code); setError(null); }} />
              <span>{r.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="sc-field">
          {noteLabel}
          <textarea value={note} maxLength={NOTE_MAX} onChange={(e) => { setNote(e.target.value); setError(null); }} aria-describedby={error ? `${id}-e` : undefined} />
        </label>
        {error ? <p id={`${id}-e`} role="alert" className="sc-err">{error}</p> : null}
        <div className="sc-actions">
          <button type="button" className="sc-btn" onClick={onClose}>{TEXT.reasonCancel}</button>
          <button type="submit" className="sc-btn sc-primary" disabled={pending}>{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}
