"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { authAlert, authChoice, authChoices, authForm, authLabel, authRow, authSubmit } from "@/components/v2/auth/ui";
import { LANGS, LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { LANG_COOKIE, readLang, serializePreference } from "@/i18n/preferences";
import type { CompleteSetupInput, CompleteSetupResult } from "@/lib/api/signup";

export type CompleteSetupAction = (input: CompleteSetupInput) => Promise<CompleteSetupResult>;
export type SetupWords = { type: string; types: { value: string; label: string }[]; language: string; submit: string; error: string };

/** The chosen language becomes the one the app speaks (the same functional cookie the language control writes). */
function rememberLanguage(lang: Lang) {
  document.cookie = serializePreference(LANG_COOKIE, lang, window.location.protocol === "https:");
}

/**
 * The first-login set-up: the kind of business and the language, then Today. `action` is the server action `completeSetup` (Job AD); pressing twice or in a second tab ends with the
 * same single business. A refusal the API explains is shown as it sent it (plain English); any other failure, the generic sentence. Language names are each language's own word for itself.
 */
export function SetupForm({ action, words, lang }: { action: CompleteSetupAction; words: SetupWords; lang: Lang }) {
  const router = useRouter();
  const [error, setError] = useState<{ text: string; english: boolean } | null>(null);
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
            const chosen = readLang(String(form.get("language") ?? lang));
            const result = await action({ businessType: String(form.get("type") ?? "") as CompleteSetupInput["businessType"], language: chosen });
            if (result.ok) {
              rememberLanguage(chosen);
              router.push("/app");
            } else setError(result.error ? { text: result.error, english: true } : { text: words.error, english: false }); // the API's own sentence is plain English
          } catch {
            setError({ text: words.error, english: false }); // the server could not be reached: nothing was saved
          }
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
      {error ? (
        <p role="alert" lang={error.english ? "en" : undefined} className={authAlert}>
          {error.text}
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
