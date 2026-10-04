"use client";

import { useActionState } from "react";

import { createTenantAction, type TenantFormState } from "./actions";

export function CreateTenantForm() {
  const [state, action, pending] = useActionState<TenantFormState, FormData>(
    createTenantAction,
    undefined,
  );
  return (
    <form className="card" action={action}>
      <label htmlFor="name">Workspace name</label>
      <input id="name" name="name" required maxLength={120} />
      <label htmlFor="slug">URL name</label>
      <input
        id="slug"
        name="slug"
        required
        minLength={3}
        maxLength={40}
        pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
        placeholder="my-business"
      />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        Create workspace
      </button>
    </form>
  );
}
