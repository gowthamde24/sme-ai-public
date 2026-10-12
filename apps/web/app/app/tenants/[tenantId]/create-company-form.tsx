"use client";

import { useActionState } from "react";

import { alertBox, btnMain, fieldInput, fieldLabel, formCard } from "@/components/v2/app/ui";

import type { CompanyFormState } from "./actions";
import { makeT, type Words } from "@/components/v2/app/words";

type Props = {
  /** `createCompanyAction.bind(null, tenantId)`, built on the server. */
  action: (
    state: CompanyFormState,
    formData: FormData,
  ) => Promise<CompanyFormState>;
  /** Generated once per render of the page, so a double submit is a safe retry. */
  formId: string; words?: Words;
};

export function CreateCompanyForm({ action, formId, words }: Props) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState<
    CompanyFormState,
    FormData
  >(action, undefined);
  return (
    <form className={formCard} action={formAction} aria-label={t("ws.create_company")}>
      <input type="hidden" name="id" value={formId} />
      <label htmlFor="company-name" className={fieldLabel}>
        {t("ws.name")}
      </label>
      <input id="company-name" className={fieldInput} name="name" required maxLength={200} />
      <label htmlFor="company-type" className={fieldLabel}>
        {t("ws.type")}
      </label>
      <select id="company-type" className={fieldInput} name="type" defaultValue="prospect">
        <option value="prospect">{t("ws.prospect")}</option>
        <option value="customer">{t("ws.customer")}</option>
        <option value="supplier">{t("ws.supplier")}</option>
        <option value="other">{t("ws.other")}</option>
      </select>
      <label htmlFor="company-website" className={fieldLabel}>
        {t("ws.website")}
      </label>
      <input id="company-website" className={fieldInput} name="website" maxLength={200} />
      <label htmlFor="company-country" className={fieldLabel}>
        {t("ws.country")}
      </label>
      <input id="company-country" className={fieldInput} name="country" maxLength={100} />
      <label htmlFor="company-city" className={fieldLabel}>
        {t("ws.city")}
      </label>
      <input id="company-city" className={fieldInput} name="city" maxLength={100} />
      <label htmlFor="company-industry" className={fieldLabel}>
        {t("ws.industry")}
      </label>
      <input id="company-industry" className={fieldInput} name="industry" maxLength={100} />
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {t("ws.create_company")}
      </button>
    </form>
  );
}
