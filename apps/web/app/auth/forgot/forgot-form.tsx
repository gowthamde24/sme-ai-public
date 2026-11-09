"use client";

import { useActionState } from "react";

import { authAlert, authField, authForm, authLabel, authNotice, authSubmitSolo } from "@/components/v2/auth/ui";
import type { AuthFormState } from "@/lib/auth/form-state";

import { requestPasswordReset } from "./actions";

export function ForgotForm({ words = { email: "Email", send: "Send the link", sending: "Sending..." } }: { words?: { email: string; send: string; sending: string } }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    undefined,
  );
  return (
    <form className={authForm} action={action}>
      <label htmlFor="email" className={authLabel}>{words.email}</label>
      <input id="email" className={authField} name="email" type="email" autoComplete="email" required maxLength={254} />
      {state?.error && (
        <p role="alert" className={authAlert}>
          {state.error}
        </p>
      )}
      {state?.message && <p role="status" className={authNotice}>{state.message}</p>}
      <button type="submit" disabled={pending} className={authSubmitSolo}>
        {pending ? words.sending : words.send}
      </button>
    </form>
  );
}
