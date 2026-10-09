"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { authAlert, authCheckBox, authCheckRow, authField, authForm, authHint, authLabel, authLink, authNotice, authRow, authSubmit } from "@/components/v2/auth/ui";

import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/auth/password-policy";

import type { SignUpAction } from "./contract";

export type SignUpWords = { name: string; email: string; password: string; passwordHint: string; business: string; terms: string; submit: string; have: string; signin: string; notAvailable: string; errors: Record<string, string> };

/**
 * The sign-up form. `action` is the server action `signUp` of Job AD; without it (it does not exist yet) the form is drawn but cannot be sent, and says "Not available yet": it never pretends
 * to create an account. A refusal shows the sentence of its error code (an unknown code, the generic one); success goes to the "check your email" screen. The page passes the words in the
 * visitor's language (this component imports no dictionary).
 */
export function SignUpForm({ action, words }: { action?: SignUpAction; words: SignUpWords }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={authForm}
      noValidate={false}
      onSubmit={(e) => {
        e.preventDefault();
        if (!action) return;
        const form = new FormData(e.currentTarget);
        const accept = form.get("terms") === "on";
        if (!accept) return setError(words.errors.terms);
        setError(null);
        start(async () => {
          const result = await action({ name: String(form.get("name") ?? "").trim(), email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? ""), businessName: String(form.get("business") ?? "").trim(), acceptTerms: true });
          if (result.ok) router.push("/signup/check-email");
          else setError(words.errors[result.error] ?? words.errors.unknown);
        });
      }}
    >
      <label htmlFor="signup-name" className={authLabel}>
        {words.name}
      </label>
      <input id="signup-name" className={authField} name="name" autoComplete="name" required maxLength={120} />
      <label htmlFor="signup-email" className={authLabel}>
        {words.email}
      </label>
      <input id="signup-email" className={authField} name="email" type="email" autoComplete="email" required maxLength={254} />
      <label htmlFor="signup-password" className={authLabel}>
        {words.password}
      </label>
      <input id="signup-password" className={authField} name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} />
      <p className={authHint}>{words.passwordHint}</p>
      <label htmlFor="signup-business" className={authLabel}>
        {words.business}
      </label>
      <input id="signup-business" className={authField} name="business" autoComplete="organization" required maxLength={120} />
      <label className={authCheckRow}>
        <input type="checkbox" name="terms" className={authCheckBox} required />
        <span lang="en">{words.terms}</span>
      </label>
      {!action ? (
        <p role="status" className={authNotice}>
          {words.notAvailable}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={authAlert}>
          {error}
        </p>
      ) : null}
      <div className={authRow}>
        <button type="submit" disabled={!action || pending} className={authSubmit}>
          {words.submit}
        </button>
      </div>
      <p className={authHint}>
        {words.have}{" "}
        <Link href="/login" className={authLink}>
          {words.signin}
        </Link>
      </p>
    </form>
  );
}
