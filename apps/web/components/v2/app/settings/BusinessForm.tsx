"use client";

import { useActionState } from "react";

import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { errorLine, field, help, label, okLine, primary } from "../visits/styles";

type State = { ok: true } | { ok: false; error: "invalid" | "role" | "failed" | "session" } | undefined;
export type BusinessWords = Readonly<Record<string, string>>;

/**
 * Settings > Business (first-run fixes): the business name, the city or area and the languages, all editable by the Owner or an Admin at any time, and where the name shows. `action` is the server action bound to the workspace.
 * A refusal shows its closed sentence; success says the new name shows everywhere. Languages are named in their own script, like everywhere else.
 */
export function BusinessForm({ action, words, name, town, languages, choices }: { action: (prev: State, formData: FormData) => Promise<State>; words: BusinessWords; name: string; town: string; languages: readonly string[]; choices: readonly CallLang[] }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const w = (key: string) => words[key] ?? key;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{w("settings.biz.title")}</h2>
      <div>
        <label htmlFor="biz-name" className={label}>
          {w("settings.biz.name")}
        </label>
        <input id="biz-name" name="name" required maxLength={120} defaultValue={name} autoComplete="organization" disabled={pending} className={field} />
        <p className={help}>{w("settings.biz.name.help")}</p>
      </div>
      <div>
        <label htmlFor="biz-town" className={label}>
          {w("settings.biz.town")}
        </label>
        <input id="biz-town" name="town" minLength={2} maxLength={80} defaultValue={town} autoComplete="address-level2" disabled={pending} className={field} />
      </div>
      <fieldset>
        <legend className={label}>{w("settings.biz.langs")}</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((code) => (
            <label key={code} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-edge bg-surface px-4 text-base has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg">
              <input type="checkbox" name="languages" value={code} defaultChecked={languages.includes(code)} disabled={pending} className="size-5 accent-brand-text" />
              {CALL_LANG_NAMES[code]}
            </label>
          ))}
        </div>
        <p className={help}>{w("settings.biz.langs.help")}</p>
      </fieldset>
      {state && !state.ok ? (
        <p role="alert" className={errorLine}>
          {w(`settings.biz.err.${state.error}`)}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className={okLine}>
          {w("settings.biz.saved")}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={pending} className={primary}>
          {w("settings.biz.save")}
        </button>
      </div>
      <div className="rounded-2xl bg-surface-2 p-4" data-part="name-used">
        <h3 className="mb-2 text-base font-semibold">{w("settings.biz.used.title")}</h3>
        <ul className="list-disc space-y-1 pl-5 text-base">
          <li>{w("settings.biz.used.1")}</li>
          <li>{w("settings.biz.used.2")}</li>
          <li>{w("settings.biz.used.3")}</li>
        </ul>
      </div>
    </form>
  );
}
