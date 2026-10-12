"use client";

import { useActionState } from "react";

import { alertBox, btnMain, fieldHelp, fieldInput, fieldLabel, fieldTextarea, formCard } from "@/components/v2/app/ui";

import type { EvidenceFormState } from "./evidence-actions";
import { makeT, type Words } from "@/components/v2/app/words";

type Props = {
  /** `addEvidenceAction.bind(null, tenantId, target, targetId)`, built on the server. */
  action: (
    state: EvidenceFormState,
    formData: FormData,
  ) => Promise<EvidenceFormState>;
  /** Generated once per render of the page, so a double submit is a safe retry. */
  formId: string; words?: Words;
};

const KINDS = ["web_page", "document", "email", "listing", "registry", "note"] as const;

export function AddEvidenceForm({ action, formId, words }: Props) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState<
    EvidenceFormState,
    FormData
  >(action, undefined);
  return (
    <form className={formCard} action={formAction} aria-label={t("ws.add_evidence")}>
      <input type="hidden" name="id" value={formId} />
      <label htmlFor="evidence-kind" className={fieldLabel}>
        {t("ws.kind")}
      </label>
      <select id="evidence-kind" name="kind" defaultValue="web_page" className={fieldInput}>
        {KINDS.map((value) => (
          <option key={value} value={value}>
            {t(`ws.evkind.${value}`)}
          </option>
        ))}
      </select>
      <label htmlFor="evidence-url" className={fieldLabel}>
        {t("ws.url_optional")}
      </label>
      <input
        id="evidence-url"
        className={fieldInput}
        name="url"
        maxLength={2048}
        placeholder={t("ws.https")}
        autoComplete="off"
        spellCheck={false}
      />
      <label htmlFor="evidence-reference" className={fieldLabel}>
        {t("ws.reference_optional")}
      </label>
      <input
        id="evidence-reference"
        className={fieldInput}
        name="reference"
        maxLength={120}
        placeholder="doc:invoice-12"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="evidence-reference-hint"
      />
      <p id="evidence-reference-hint" className={fieldHelp}>
        {t("ws.a_short_typed_reference_a_lower")}
      </p>
      <label htmlFor="evidence-snippet" className={fieldLabel}>
        {t("ws.snippet_optional")}
      </label>
      <textarea
        id="evidence-snippet"
        className={fieldTextarea}
        name="snippet"
        rows={4}
        maxLength={1000}
      />
      <label htmlFor="evidence-published" className={fieldLabel}>
        {t("ws.published_on_optional")}
      </label>
      <input id="evidence-published" name="published_at" type="date" className={fieldInput} />
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {t("ws.add_evidence")}
      </button>
    </form>
  );
}
