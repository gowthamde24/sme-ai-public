"use client";

import Link from "next/link";
import { lazy, Suspense, useActionState, useState } from "react";

import { authAlert, authField, authForm, authLabel, authLink, authNotice, authRow, authSubmit } from "@/components/v2/auth/ui";

import { type AuthFormState, signIn } from "./actions";

/** The check box is a chunk of its own, loaded only when it is needed (the sign-in page carries nothing for it otherwise). */
const Turnstile = lazy(() => import("@/components/v2/controls/Turnstile").then((m) => ({ default: m.Turnstile })));

export function LoginForm({ next, notice, turnstile = null }: { next: string; notice?: string; /** The Turnstile site key when the check is on; the box is drawn after three failures in a row. */ turnstile?: string | null }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signIn,
    undefined,
  );
  const [tries, setTries] = useState(0);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setTries((n) => n + 1); // a Turnstile token is good for one try: ask for a new one after every answer
  }

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
      {turnstile && state?.check ? (
        <Suspense fallback={<div className="min-h-[65px]" />}>
          <Turnstile siteKey={turnstile} lang="en" onToken={() => undefined} again={tries} />
        </Suspense>
      ) : null}
      <div className={authRow}>
        <button type="submit" disabled={pending} className={authSubmit}>
          Sign in
        </button>
        <Link href="/auth/forgot" className={authLink}>
          Forgot your password?
        </Link>
      </div>
    </form>
  );
}
