"use client";

import { useState, useTransition } from "react";

import { GRIEVANCE_KINDS, type GrievanceKind, type GrievanceResult } from "@/lib/dpdp/types";

import { card, errorLine, field, h2, label, muted, okLine, primary, selectClass } from "../cc/kit";
import { makeT, type Words } from "../words";

/**
 * Settings > Privacy and data > "Raise a grievance" (job DQ part 2): a name, an e-mail address or phone number, what it is about and, if the person wants, what happened. The API keeps it, acknowledges it at once and answers in the time the
 * notice promises; the person gets a reference and the day the answer is due. The name and the contact are filled from the account when the page knows them; the person can change them. The form is replaced by the receipt after a good answer.
 */
export function GrievanceForm({ words, lang, action, defaults, days, email }: { words: Words; lang: "en" | "te" | "hi" | "kn"; action: (input: unknown) => Promise<GrievanceResult>; defaults: { name: string; contact: string }; days: number; email: string }) {
  const t = makeT(words);
  const [name, setName] = useState(defaults.name);
  const [contact, setContact] = useState(defaults.contact);
  const [kind, setKind] = useState<GrievanceKind>("complaint");
  const [details, setDetails] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ reference: string; due: string } | null>(null);
  const [pending, start] = useTransition();
  const errors: Record<string, string> = { name: t("dpdp.gr.err.name"), contact: t("dpdp.gr.err.contact"), rate: t("dpdp.gr.err.rate"), down: t("dpdp.gr.err.down", { email }), invalid: t("dpdp.gr.err.invalid") };
  return (
    <section className={card} aria-labelledby="dpdp-gr-h" data-privacy="grievance">
      <h2 id="dpdp-gr-h" className={h2}>
        {t("dpdp.gr.title")}
      </h2>
      <p className={muted}>{t("dpdp.gr.intro", { days, email })}</p>
      {receipt ? (
        <div role="status" className="mt-3" data-privacy="grievance-receipt">
          <p className={okLine}>{t("dpdp.gr.done.title")}</p>
          <p className="text-base">{t("dpdp.gr.done", { ref: receipt.reference, date: receipt.due })}</p>
          <p className={muted}>{t("dpdp.gr.board")}</p>
        </div>
      ) : (
        <form
          data-write
          className="mt-3 flex max-w-xl flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            start(async () => {
              try {
                const out = await action({ name, contact, kind, details, language: lang });
                if (out.ok) setReceipt({ reference: out.reference, due: out.answerDueOn });
                else setProblem(errors[out.error] ?? errors.invalid);
              } catch {
                setProblem(errors.down);
              }
            });
          }}
        >
          <div>
            <label htmlFor="gr-name" className={label}>
              {t("dpdp.gr.name")}
            </label>
            <input id="gr-name" className={field} autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="gr-contact" className={label}>
              {t("dpdp.gr.contact")}
            </label>
            <input id="gr-contact" className={field} autoComplete="email" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div>
            <label htmlFor="gr-kind" className={label}>
              {t("dpdp.gr.kind")}
            </label>
            <select id="gr-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as GrievanceKind)}>
              {GRIEVANCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`dpdp.gr.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="gr-details" className={label}>
              {t("dpdp.gr.details")}
            </label>
            <textarea id="gr-details" className={`${field} min-h-28 py-2`} rows={4} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          {problem ? (
            <p role="alert" className={errorLine}>
              {problem}
            </p>
          ) : null}
          <button type="submit" disabled={pending} className={`${primary} self-start disabled:opacity-60`}>
            {t("dpdp.gr.submit")}
          </button>
        </form>
      )}
    </section>
  );
}
