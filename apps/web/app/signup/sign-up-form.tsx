"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { authAlert, authField, authForm, authHint, authLabel, authRow, authSubmit } from "@/components/v2/auth/ui";
import type { SignUpInput, SignUpResult } from "@/lib/api/signup";

import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/auth/password-policy";

export type SignUpAction = (input: SignUpInput) => Promise<SignUpResult>;

export type SignUpWords = { email: string; password: string; passwordHint: string; submit: string; errors: Record<string, string> };

/**
 * The e-mail way of step 2 (job CL): an address and a password, nothing else. The kind of business comes from step 1 (`businessType`); the name and the business name are not asked (the server derives them, the first
 * checklist step asks the real business name). The terms are not a tick box any more: the page says "By continuing you agree to the Terms and the Privacy Policy" under all three ways in, and `acceptTerms` here is
 * what pressing the button means (the versions shown are recorded, job CF). `action` is the server action `signUp`; a refusal shows the sentence of its error code. Success goes to "check your email".
 */
export function SignUpForm({ action, words, businessType, policyVersions }: { action: SignUpAction; words: SignUpWords; businessType: string; policyVersions?: { terms: string; privacy: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={authForm}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          try {
            const result = await action({ email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? ""), businessType, acceptTerms: true, marketingOptIn: (document.getElementById("signup-marketing") as HTMLInputElement | null)?.checked === true, ...(policyVersions ? { policyVersions } : {}) });
            if (result.ok) router.push(`/signup/${result.next}`);
            else setError(words.errors[result.error] ?? words.errors.unknown);
          } catch {
            setError(words.errors.unknown); // the server could not be reached: nothing was created
          }
        });
      }}
    >
      <label htmlFor="signup-email" className={authLabel}>
        {words.email}
      </label>
      <input id="signup-email" className={authField} name="email" type="email" autoComplete="email" required maxLength={254} />
      <label htmlFor="signup-password" className={authLabel}>
        {words.password}
      </label>
      <input id="signup-password" className={authField} name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} />
      <p className={authHint}>{words.passwordHint}</p>
      {error ? (
        <p role="alert" className={authAlert}>
          {error}
        </p>
      ) : null}
      <div className={authRow}>
        <button type="submit" disabled={pending} className={authSubmit}>
          {words.submit}
        </button>
      </div>
    </form>
  );
}
