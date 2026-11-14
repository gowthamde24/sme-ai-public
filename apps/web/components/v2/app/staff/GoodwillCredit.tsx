"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import { confirmCodeAction, creditAction } from "@/app/staff/actions";
import { NOTE_MAX, REASONS, newCreditKey, parseRupees, wordsProblem } from "@/lib/staff/reasons";
import { SUP, TEXT } from "@/lib/staff/words";

import { leaveIfSignedOut } from "./outcome";

/**
 * Goodwill credit (owner and finance; C1 slice 3): an amount of whole rupees (₹100 to ₹1,000), typed AGAIN to confirm, a reason and words (always, for money), and ONE idempotency key per click. When the API says the money step needs a
 * fresh authenticator code (403 second_confirm_required) the box asks for the 6 digits (the same Supabase challenge as sign-in), then sends the SAME request with the SAME key: a retry credits nothing twice and says so. The limits (₹1,000 a
 * time, ₹3,000 per business per 30 days) are the API's; the sentence for going over is plain. Nothing here shows the staff member's name or the amount to anyone else.
 */
export function GoodwillCredit({ tenantId, name }: { tenantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className="sc-btn" aria-haspopup="dialog" data-part="credit" aria-label={`${SUP.credit}: ${name}`} onClick={() => setOpen(true)}>
        {SUP.credit}
      </button>
      {open ? <CreditDialog tenantId={tenantId} name={name} onClose={close} /> : null}
    </>
  );
}

function CreditDialog({ tenantId, name, onClose }: { tenantId: string; name: string; onClose: () => void }) {
  const id = useId();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [again, setAgain] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef<string | null>(null); // one key per click of "Add credit"; a retry after the code step reuses it
  const first = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (step === "code") codeField.current?.focus();
  }, [step]);

  async function send(): Promise<void> {
    const paise = parseRupees(amount);
    if (paise === null) return void setError(SUP.creditBadAmount);
    if (parseRupees(again) !== paise) return void setError(SUP.creditMismatch);
    if (wordsProblem(code, note) !== null) return void setError(SUP.creditNeedReason);
    setError(null);
    key.current ??= newCreditKey();
    const out = await creditAction(tenantId, { amountPaise: paise, confirmPaise: paise, code, text: note.trim(), key: key.current });
    if (out.ok) {
      setDone(out.data.replayed ? SUP.creditReplayed : SUP.creditDone(out.data.creditedText, out.data.balanceText));
      setStep("done");
      key.current = null;
      router.refresh();
      return;
    }
    if (leaveIfSignedOut(out.failure)) return;
    if (out.failure === "second_confirm_required") return void setStep("code");
    key.current = out.failure === "unavailable" ? key.current : null; // an unknown outcome keeps the key (the retry is the same click); a clear refusal starts fresh
    setError(out.failure === "goodwill_limit" ? SUP.creditLimit : out.failure === "reason_required" ? SUP.creditNeedReason : out.failure === "invalid" ? SUP.creditBadAmount : out.failure === "no_access" ? TEXT.reasonNoAccess : SUP.creditFailed);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(send);
  }
  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const ok = await confirmCodeAction(digits);
      if (!ok.ok) {
        if (ok.failure !== "invalid" && leaveIfSignedOut(ok.failure)) return;
        return void setError(SUP.codeWrong);
      }
      setDigits("");
      setError(null);
      await send(); // the SAME key as the first try
    });
  }

  return (
    <div className="sc-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {step === "code" ? (
        <form className="sc-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onSubmit={submitCode} noValidate data-part="credit-code">
          <h2 id={`${id}-t`}>{SUP.codeTitle}</h2>
          <p>{SUP.codeIntro}</p>
          <label className="sc-field">
            {SUP.codeLabel}
            <input ref={codeField} className="sc-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={digits} onChange={(e) => { setDigits(e.target.value); setError(null); }} />
          </label>
          {error ? <p role="alert" className="sc-err">{error}</p> : null}
          <div className="sc-actions">
            <button type="button" className="sc-btn" onClick={onClose}>{TEXT.reasonCancel}</button>
            <button type="submit" className="sc-btn sc-primary" disabled={pending}>{SUP.codeGo}</button>
          </div>
        </form>
      ) : step === "done" ? (
        <div className="sc-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} data-part="credit-done">
          <h2 id={`${id}-t`}>{SUP.credit}</h2>
          <p role="status">{done}</p>
          <div className="sc-actions">
            <button type="button" className="sc-btn sc-primary" onClick={onClose}>OK</button>
          </div>
        </div>
      ) : (
        <form className="sc-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onSubmit={submit} noValidate data-part="credit-form">
          <h2 id={`${id}-t`}>{SUP.creditTitle(name)}</h2>
          <p>{SUP.creditIntro}</p>
          <label className="sc-field">
            {SUP.creditAmount}
            <input ref={first} className="sc-input" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} />
          </label>
          <label className="sc-field">
            {SUP.creditAgain}
            <input className="sc-input" inputMode="numeric" value={again} onChange={(e) => { setAgain(e.target.value); setError(null); }} />
          </label>
          <fieldset>
            <legend>{TEXT.reasonLegend}</legend>
            {REASONS.map((r) => (
              <label key={r.code} className="sc-radio">
                <input type="radio" name={`${id}-reason`} value={r.code} checked={code === r.code} onChange={() => { setCode(r.code); setError(null); }} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="sc-field">
            {SUP.creditReason}
            <textarea value={note} maxLength={NOTE_MAX} onChange={(e) => { setNote(e.target.value); setError(null); }} />
          </label>
          {error ? <p role="alert" className="sc-err">{error}</p> : null}
          <div className="sc-actions">
            <button type="button" className="sc-btn" onClick={onClose}>{TEXT.reasonCancel}</button>
            <button type="submit" className="sc-btn sc-primary" disabled={pending}>{SUP.creditGo}</button>
          </div>
        </form>
      )}
    </div>
  );
}
