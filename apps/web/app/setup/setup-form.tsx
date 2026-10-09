"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { authAlert, authChoice, authChoices, authForm, authLabel, authNotice, authRow, authSubmit } from "@/components/v2/auth/ui";
import type { CompleteSetupAction } from "@/app/signup/contract";
import { LANGS, LANGUAGE_NAMES, type Lang } from "@/i18n/lang";

export type SetupWords = { type: string; types: { value: string; label: string }[]; language: string; submit: string; notAvailable: string; error: string };

/**
 * The first-login set-up: the kind of business and the language, then Today. `action` is the server action `completeSetup` of Job AD; without it the form says "Not available yet" and
 * cannot be sent. Language names are each language's own word for itself.
 */
export function SetupForm({ action, words, lang }: { action?: CompleteSetupAction; words: SetupWords; lang: Lang }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={authForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (!action) return;
        const form = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const result = await action({ businessType: String(form.get("type") ?? ""), language: String(form.get("language") ?? lang) as Lang });
          if (result.ok) router.push("/app");
          else setError(words.error);
        });
      }}
    >
      <fieldset>
        <legend className={authLabel}>{words.type}</legend>
        <div className={authChoices}>
          {words.types.map((o, i) => (
            <label key={o.value} className={authChoice}>
              <input type="radio" name="type" value={o.value} required defaultChecked={i === 0} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={authLabel}>{words.language}</legend>
        <div className={authChoices}>
          {LANGS.map((l) => (
            <label key={l} className={authChoice}>
              <input type="radio" name="language" value={l} defaultChecked={l === lang} />
              {LANGUAGE_NAMES[l].native}
            </label>
          ))}
        </div>
      </fieldset>
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
    </form>
  );
}
