"use client";

import { useActionState } from "react";

import { authAlert, authCode, authForm, authLabel, authSecondary, authSubmitSolo } from "@/components/v2/auth/ui";
import type { AuthFormState } from "@/lib/auth/form-state";

import { leaveChallenge, verifyCode } from "./actions";

export function MfaForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    verifyCode,
    undefined,
  );
  return (
    <>
      <form className={authForm} action={action}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="code" className={authLabel}>Code from your authenticator app</label>
        <input
          id="code"
          className={authCode}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          autoFocus
        />
        {state?.error && (
          <p role="alert" className={authAlert}>
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className={authSubmitSolo}>
          {pending ? "Checking..." : "Verify"}
        </button>
      </form>
      <form action={leaveChallenge}>
        <button type="submit" className={authSecondary}>
          Sign out
        </button>
      </form>
    </>
  );
}
