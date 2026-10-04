"use client";

import { useActionState } from "react";

import type { EvidenceFormState } from "./evidence-actions";

type Props = {
  /** `addEvidenceAction.bind(null, tenantId, target, targetId)`, built on the server. */
  action: (
    state: EvidenceFormState,
    formData: FormData,
  ) => Promise<EvidenceFormState>;
  /** Generated once per render of the page, so a double submit is a safe retry. */
  formId: string;
};

const KINDS: [string, string][] = [
  ["web_page", "Web page"],
  ["document", "Document"],
  ["email", "Email"],
  ["listing", "Listing"],
  ["registry", "Registry"],
  ["note", "Note"],
];

export function AddEvidenceForm({ action, formId }: Props) {
  const [state, formAction, pending] = useActionState<
    EvidenceFormState,
    FormData
  >(action, undefined);
  return (
    <form className="card" action={formAction} aria-label="Add evidence">
      <input type="hidden" name="id" value={formId} />
      <label htmlFor="evidence-kind">Kind</label>
      <select id="evidence-kind" name="kind" defaultValue="web_page">
        {KINDS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor="evidence-url">URL (optional)</label>
      <input
        id="evidence-url"
        name="url"
        maxLength={2048}
        placeholder="https://…"
        autoComplete="off"
        spellCheck={false}
      />
      <label htmlFor="evidence-reference">Reference (optional)</label>
      <input
        id="evidence-reference"
        name="reference"
        maxLength={120}
        placeholder="doc:invoice-12"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="evidence-reference-hint"
      />
      <p id="evidence-reference-hint" className="hint">
        A short typed reference: a lower-case prefix, a colon, then letters,
        digits or . _ # / - (for example doc:catalogue-2026 or upload:a1.pdf).
        Enter a URL, a reference, or both.
      </p>
      <label htmlFor="evidence-snippet">Snippet (optional)</label>
      <textarea
        id="evidence-snippet"
        name="snippet"
        rows={4}
        maxLength={1000}
      />
      <label htmlFor="evidence-published">Published on (optional)</label>
      <input id="evidence-published" name="published_at" type="date" />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        Add evidence
      </button>
    </form>
  );
}
