"use client";

import { useActionState } from "react";

import { alertBox, btnMain, fieldInput, fieldLabel, formCard } from "@/components/v2/app/ui";

import { createTenantAction, type TenantFormState } from "./actions";

export function CreateTenantForm() {
  const [state, action, pending] = useActionState<TenantFormState, FormData>(
    createTenantAction,
    undefined,
  );
  return (
    <form className={formCard} action={action}>
      <label htmlFor="name" className={fieldLabel}>
        Workspace name
      </label>
      <input id="name" className={fieldInput} name="name" required maxLength={120} />
      <label htmlFor="slug" className={fieldLabel}>
        URL name
      </label>
      <input
        id="slug"
        className={fieldInput}
        name="slug"
        required
        minLength={3}
        maxLength={40}
        pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
        placeholder="my-business"
      />
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        Create workspace
      </button>
    </form>
  );
}
