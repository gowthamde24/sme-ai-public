"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { authAlert, authCheckBox, authCheckRow, authField, authForm, authHint, authLabel, authLink, authRow, authSubmit } from "@/components/v2/auth/ui";
import type { SignUpInput, SignUpResult } from "@/lib/api/signup";

import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/auth/password-policy";

/** A link inside a sentence (the terms line): inline text, underlined; the line itself is 44 px tall (a link in running text is exempt from the target size). */
const inlineLink = "font-semibold text-brand-text underline underline-offset-2";

export type SignUpAction = (input: SignUpInput) => Promise<SignUpResult>;

export type SignUpWords = { name: string; email: string; password: string; passwordHint: string; business: string; /** "I agree to the {terms} and the {privacy}." */ terms: string; termsLink: string; privacyLink: string; submit: string; have: string; signin: string; errors: Record<string, string> };

/**
 * The sign-up form. `action` is the server action `signUp` (Job AD). A refusal shows the sentence of its error code (an unknown code, the generic one); success goes to the screen the answer names
 * ("check your email"). The page passes the words in the visitor's language (this component imports no dictionary).
 */
export function SignUpForm({ action, words, policyVersions }: { action: SignUpAction; words: SignUpWords; policyVersions?: { terms: string; privacy: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={authForm}
      noValidate={false}
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const accept = form.get("terms") === "on";
        if (!accept) return setError(words.errors.terms_required);
        setError(null);
        start(async () => {
          try {
            const result = await action({ name: String(form.get("name") ?? "").trim(), email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? ""), businessName: String(form.get("business") ?? "").trim(), acceptTerms: true, ...(policyVersions ? { policyVersions } : {}) });
            if (result.ok) router.push(`/signup/${result.next}`);
            else setError(words.errors[result.error] ?? words.errors.unknown);
          } catch {
            setError(words.errors.unknown); // the server could not be reached: nothing was created
          }
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
        <span lang="en">
          {words.terms.split(/(\{terms\}|\{privacy\})/).map((part, i) =>
            part === "{terms}" ? (
              <Link key={i} href="/terms" target="_blank" rel="noopener" className={inlineLink}>
                {words.termsLink}
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>
            ) : part === "{privacy}" ? (
              <Link key={i} href="/privacy" target="_blank" rel="noopener" className={inlineLink}>
                {words.privacyLink}
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>
            ) : (
              part
            ),
          )}
        </span>
      </label>
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
      <p className={authHint}>
        {words.have}{" "}
        <Link href="/login" className={authLink}>
          {words.signin}
        </Link>
      </p>
    </form>
  );
}
