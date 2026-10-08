"use client";

import { useActionState } from "react";

import { authAlert, authField, authForm, authHint, authLabel, authSubmitSolo } from "@/components/v2/auth/ui";
import type { AuthFormState } from "@/lib/auth/form-state";
import { MIN_PASSWORD, MAX_PASSWORD } from "@/lib/auth/password-policy";

import { setPassword } from "./actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    setPassword,
    undefined,
  );
  return (
    <form className={authForm} action={action}>
      <label htmlFor="password" className={authLabel}>New password</label>
      <input
        id="password"
        className={authField}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD}
        maxLength={MAX_PASSWORD}
      />
      <p className={authHint}>At least {MIN_PASSWORD} characters. A few words in a row work well.</p>
      <label htmlFor="confirm" className={authLabel}>Type it again</label>
      <input
        id="confirm"
        className={authField}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        maxLength={MAX_PASSWORD}
      />
      {state?.error && (
        <p role="alert" className={authAlert}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={authSubmitSolo}>
        {pending ? "Saving..." : "Save password"}
      </button>
    </form>
  );
}
