"use client";

import { useActionState } from "react";

import { type AuthFormState, signIn, signUp } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [signInState, signInAction, signingIn] = useActionState<
    AuthFormState,
    FormData
  >(signIn, undefined);
  const [signUpState, signUpAction, signingUp] = useActionState<
    AuthFormState,
    FormData
  >(signUp, undefined);
  const state = signUpState ?? signInState;
  const pending = signingIn || signingUp;

  return (
    <form className="card" action={signInAction}>
      <input type="hidden" name="next" value={next} />
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
      {state?.message && <p role="status">{state.message}</p>}
      <div className="row">
        <button type="submit" disabled={pending}>
          Sign in
        </button>
        <button
          type="submit"
          formAction={signUpAction}
          disabled={pending}
          className="secondary"
        >
          Create account
        </button>
      </div>
    </form>
  );
}
