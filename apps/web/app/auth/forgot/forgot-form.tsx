"use client";

import { useActionState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";

import { requestPasswordReset } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    undefined,
  );
  return (
    <form className="card" action={action}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state?.message && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send the link"}
      </button>
    </form>
  );
}
