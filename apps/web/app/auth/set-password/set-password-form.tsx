"use client";

import { useActionState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";
import { MIN_PASSWORD, MAX_PASSWORD } from "@/lib/auth/password-policy";

import { setPassword } from "./actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    setPassword,
    undefined,
  );
  return (
    <form className="card" action={action}>
      <label htmlFor="password">New password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD}
        maxLength={MAX_PASSWORD}
      />
      <p className="hint">At least {MIN_PASSWORD} characters. A few words in a row work well.</p>
      <label htmlFor="confirm">Type it again</label>
      <input
        id="confirm"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        maxLength={MAX_PASSWORD}
      />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save password"}
      </button>
    </form>
  );
}
