"use client";

import { useActionState } from "react";

import { authAlert, authField, authForm, authLabel, authNotice, authSubmitSolo } from "@/components/v2/auth/ui";
import type { AuthFormState } from "@/lib/auth/form-state";

import { requestPasswordReset } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    undefined,
  );
  return (
    <form className={authForm} action={action}>
      <label htmlFor="email" className={authLabel}>Email</label>
      <input id="email" className={authField} name="email" type="email" autoComplete="email" required maxLength={254} />
      {state?.error && (
        <p role="alert" className={authAlert}>
          {state.error}
        </p>
      )}
      {state?.message && <p role="status" className={authNotice}>{state.message}</p>}
      <button type="submit" disabled={pending} className={authSubmitSolo}>
        {pending ? "Sending..." : "Send the link"}
      </button>
    </form>
  );
}
