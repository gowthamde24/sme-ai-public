"use client";

import Link from "next/link";
import { useActionState } from "react";

import { type AuthFormState, signIn } from "./actions";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signIn,
    undefined,
  );

  return (
    <form className="card" action={action}>
      <input type="hidden" name="next" value={next} />
      {notice && <p role="status">{notice}</p>}
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={72}
      />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={pending}>
          Sign in
        </button>
        <Link href="/auth/forgot" className="hint">
          Forgot your password?
        </Link>
      </div>
      <p className="hint">
        Accounts are by invitation. Ask the owner of your workspace if you need one.
      </p>
    </form>
  );
}
