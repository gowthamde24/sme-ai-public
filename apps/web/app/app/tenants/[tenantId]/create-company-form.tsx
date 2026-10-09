"use client";

import { useActionState } from "react";

import { alertBox, btnMain, fieldInput, fieldLabel, formCard } from "@/components/v2/app/ui";

import type { CompanyFormState } from "./actions";

type Props = {
  /** `createCompanyAction.bind(null, tenantId)`, built on the server. */
  action: (
    state: CompanyFormState,
    formData: FormData,
  ) => Promise<CompanyFormState>;
  /** Generated once per render of the page, so a double submit is a safe retry. */
  formId: string;
};

export function CreateCompanyForm({ action, formId }: Props) {
  const [state, formAction, pending] = useActionState<
    CompanyFormState,
    FormData
  >(action, undefined);
  return (
    <form className={formCard} action={formAction} aria-label="Create company">
      <input type="hidden" name="id" value={formId} />
      <label htmlFor="company-name" className={fieldLabel}>
        Name
      </label>
      <input id="company-name" className={fieldInput} name="name" required maxLength={200} />
      <label htmlFor="company-type" className={fieldLabel}>
        Type
      </label>
      <select id="company-type" className={fieldInput} name="type" defaultValue="prospect">
        <option value="prospect">Prospect</option>
        <option value="customer">Customer</option>
        <option value="supplier">Supplier</option>
        <option value="other">Other</option>
      </select>
      <label htmlFor="company-website" className={fieldLabel}>
        Website
      </label>
      <input id="company-website" className={fieldInput} name="website" maxLength={200} />
      <label htmlFor="company-country" className={fieldLabel}>
        Country
      </label>
      <input id="company-country" className={fieldInput} name="country" maxLength={100} />
      <label htmlFor="company-city" className={fieldLabel}>
        City
      </label>
      <input id="company-city" className={fieldInput} name="city" maxLength={100} />
      <label htmlFor="company-industry" className={fieldLabel}>
        Industry
      </label>
      <input id="company-industry" className={fieldInput} name="industry" maxLength={100} />
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        Create company
      </button>
    </form>
  );
}
