"use client";

import { useActionState, useId } from "react";

import { alertBox, btnMain, fieldInput, fieldLabel, formCard } from "@/components/v2/app/ui";

import { createTenantAction, type TenantFormState } from "./actions";

export function CreateTenantForm() {
  // the form is drawn in the side menu and on /app, so two can be open at once: each needs ids of its own (the name= attributes stay as they are)
  const uid = useId();
  const nameId = `${uid}-name`;
  const slugId = `${uid}-slug`;
  const [state, action, pending] = useActionState<TenantFormState, FormData>(
    createTenantAction,
    undefined,
  );
  return (
    <form className={formCard} action={action}>
      <label htmlFor={nameId} className={fieldLabel}>
        Workspace name
      </label>
      <input id={nameId} className={fieldInput} name="name" required maxLength={120} />
      <label htmlFor={slugId} className={fieldLabel}>
        URL name
      </label>
      <input
        id={slugId}
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
