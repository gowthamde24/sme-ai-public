"use client";

import { useActionState } from "react";

import type { AuthFormState } from "@/lib/auth/form-state";

import { leaveChallenge, verifyCode } from "./actions";

export function MfaForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    verifyCode,
    undefined,
  );
  return (
    <>
      <form className="card" action={action}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="code">Code from your authenticator app</label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          autoFocus
        />
        {state?.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? "Checking..." : "Verify"}
        </button>
      </form>
      <form action={leaveChallenge}>
        <button type="submit" className="secondary">
          Sign out
        </button>
      </form>
    </>
  );
}
