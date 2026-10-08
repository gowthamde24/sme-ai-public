"use client";

import Link from "next/link";
import { useActionState } from "react";

import { authAlert, authField, authForm, authHint, authLabel, authLink, authNotice, authRow, authSubmit } from "@/components/v2/auth/ui";

import { type AuthFormState, signIn } from "./actions";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signIn,
    undefined,
  );

  return (
    <form className={authForm} action={action}>
      <input type="hidden" name="next" value={next} />
      {notice && <p role="status" className={authNotice}>{notice}</p>}
      <label htmlFor="email" className={authLabel}>Email</label>
      <input
        id="email"
        className={authField}
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
      />
      <label htmlFor="password" className={authLabel}>Password</label>
      <input
        id="password"
        className={authField}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={72}
      />
      {state?.error && (
        <p role="alert" className={authAlert}>
          {state.error}
        </p>
      )}
      <div className={authRow}>
        <button type="submit" disabled={pending} className={authSubmit}>
          Sign in
        </button>
        <Link href="/auth/forgot" className={authLink}>
          Forgot your password?
        </Link>
      </div>
      <p className={authHint}>
        Accounts are by invitation. Ask the owner of your workspace if you need one.
      </p>
    </form>
  );
}
