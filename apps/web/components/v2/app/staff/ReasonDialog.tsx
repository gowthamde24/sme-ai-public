"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { openAccessAction } from "@/app/staff/actions";
import { NOTE_MAX, REASONS, reasonProblem } from "@/lib/staff/reasons";
import { TEXT } from "@/lib/staff/words";

/**
 * The reason box: opening a business (a read-only support view) first asks WHY. A reason is chosen (no default), "Something else" must say what (3 to 300 characters), and only then is `POST /v1/admin/access` asked; the answer opens the support view.
 * Inline words for the refusals: no reason chosen (422 reason_required), the business wants its owner's OK first (409 owner_ok_required), no access (403). A staff session that ended (401) goes to its own plain page. Esc and Cancel close it.
 */
export function ReasonDialog({ tenantId, name, onClose }: { tenantId: string; name: string; onClose: () => void }) {
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
    const problem = reasonProblem(code, note);
    if (problem) {
      setError(problem === "choose" ? TEXT.reasonChoose : TEXT.reasonSayWhat);
      return;
    }
    setError(null);
    start(async () => {
      const answer = await openAccessAction(tenantId, code, note);
      if (answer.ok) {
        window.location.assign(answer.href);
        return;
      }
      if (answer.failure === "signed_out") {
        window.location.assign("/staff/signed-out");
        return;
      }
      setError(answer.failure === "reason_required" ? (code === "other" ? TEXT.reasonSayWhat : TEXT.reasonChoose) : answer.failure === "owner_ok_required" ? TEXT.reasonOwnerOk : answer.failure === "no_access" ? TEXT.reasonNoAccess : TEXT.reasonFailed);
    });
  }

  return (
    <div className="sc-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sc-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onSubmit={submit} noValidate>
        <h2 id={`${id}-t`}>{TEXT.reasonTitle(name)}</h2>
        <p>{TEXT.reasonIntro}</p>
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
          {code === "other" ? TEXT.reasonNote : TEXT.reasonNoteMore}
          <textarea value={note} maxLength={NOTE_MAX} onChange={(e) => { setNote(e.target.value); setError(null); }} aria-describedby={error ? `${id}-e` : undefined} />
        </label>
        {error ? <p id={`${id}-e`} role="alert" className="sc-err">{error}</p> : null}
        <div className="sc-actions">
          <button type="button" className="sc-btn" onClick={onClose}>{TEXT.reasonCancel}</button>
          <button type="submit" className="sc-btn sc-primary" disabled={pending}>{TEXT.reasonOpen}</button>
        </div>
      </form>
    </div>
  );
}
