"use client";

import { useActionState } from "react";

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
    <form className="card" action={formAction} aria-label="Create company">
      <input type="hidden" name="id" value={formId} />
      <label htmlFor="company-name">Name</label>
      <input id="company-name" name="name" required maxLength={200} />
      <label htmlFor="company-type">Type</label>
      <select id="company-type" name="type" defaultValue="prospect">
        <option value="prospect">Prospect</option>
        <option value="customer">Customer</option>
        <option value="supplier">Supplier</option>
        <option value="other">Other</option>
      </select>
      <label htmlFor="company-website">Website</label>
      <input id="company-website" name="website" maxLength={200} />
      <label htmlFor="company-country">Country</label>
      <input id="company-country" name="country" maxLength={100} />
      <label htmlFor="company-city">City</label>
      <input id="company-city" name="city" maxLength={100} />
      <label htmlFor="company-industry">Industry</label>
      <input id="company-industry" name="industry" maxLength={100} />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        Create company
      </button>
    </form>
  );
}
