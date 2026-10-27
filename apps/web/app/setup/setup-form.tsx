"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { TypeCombobox, type TypeGroup, type TypeWords, OTHER_MAX, OTHER_MIN } from "@/components/v2/auth/TypeCombobox";
import { authAlert, authChoice, authChoices, authField, authForm, authHint, authLabel, authRow, authSubmit } from "@/components/v2/auth/ui";
import { LANGS, LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { LANG_COOKIE, readLang, serializePreference } from "@/i18n/preferences";
import type { CompleteSetupInput, CompleteSetupResult } from "@/lib/api/signup";

export type CompleteSetupAction = (input: CompleteSetupInput) => Promise<CompleteSetupResult>;
export type SetupWords = { type: TypeWords; name: string; nameHelp: string; language: string; submit: string; error: string };

/** The chosen language becomes the one the app speaks (the same functional cookie the language control writes). */
function rememberLanguage(lang: Lang) {
  document.cookie = serializePreference(LANG_COOKIE, lang, window.location.protocol === "https:");
}

/**
 * The first-login set-up (first-run fixes): the only two things asked are the kind of business (one searchable list, with "Other") and its name; everything else of the set-up can be skipped and is found again as "Finish setting up" on Today.
 * The language is a small choice with the language already in use ticked. `action` is the server action `completeSetup`; pressing twice or in a second tab ends with the same single business. A refusal the API explains is shown as it
 * sent it (plain English); any other failure, the generic sentence. `remembered` is the kind chosen at sign-up (kept by the account or the browser), ticked at the start; `otherId` is the "Other" kind, which asks what the business is.
 */
export function SetupForm({ action, words, lang, groups, remembered = null, otherId = null }: { action: CompleteSetupAction; words: SetupWords; lang: Lang; groups: readonly TypeGroup[]; remembered?: string | null; otherId?: string | null }) {
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
        const businessType = String(form.get("type") ?? "") || remembered || "";
        const businessName = String(form.get("business_name") ?? "").trim();
        const label = String(form.get("other_label") ?? "").trim();
        if (businessType === "") return setError({ text: words.type.none, english: false });
        start(async () => {
          try {
            const chosen = readLang(String(form.get("language") ?? lang));
            const result = await action({ businessType, language: chosen, businessName, ...(otherId !== null && businessType === otherId ? { businessLabel: label } : {}) });
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
      {groups.length > 0 ? <TypeCombobox groups={groups} words={words.type} otherId={otherId} initial={remembered} /> : <input type="hidden" name="type" value={remembered ?? ""} />}
      <label htmlFor="setup-business-name" className={authLabel}>
        {words.name}
      </label>
      <input id="setup-business-name" name="business_name" type="text" required maxLength={120} minLength={1} autoComplete="organization" className={authField} />
      <p className={authHint}>{words.nameHelp}</p>
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

export { OTHER_MAX, OTHER_MIN };
