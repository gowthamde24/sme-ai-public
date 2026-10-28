"use client";

import { useActionState } from "react";

import { TypeCombobox, type TypeGroup, type TypeWords } from "@/components/v2/auth/TypeCombobox";
import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { errorLine, field, help, label, okLine, primary, secondary } from "../visits/styles";

type State = { ok: true } | { ok: false; error: string } | undefined;
export type BusinessWords = Readonly<Record<string, string>>;
/** What only the Owner changes: the kind of business (the same searchable list as at set-up, with "Other") and the business phone. */
export type OwnerFields = { groups: readonly TypeGroup[]; typeWords: TypeWords; otherId: string | null; type: string; typeLabel: string; phone: string };
/** Where the name shows, as the API lists it (closed words); empty = the API did not say, so the three plain lines are shown. */
const USED: Readonly<Record<string, string>> = { menu_header: "1", call_opening: "2", whatsapp_opening: "2", assistant_greeting: "3", voice_preview: "4" };

/**
 * Settings > Business (first-run fixes): the business name, the city or area and the languages, all editable by the Owner or an Admin at any time, and where the name shows; the Owner also changes the kind of business and the phone (`owner`).
 * `action` is the server action bound to the workspace. A refusal shows its closed sentence (a change of kind the data does not allow says why); success says the new name shows everywhere. Languages are named in their own script, like everywhere else.
 */
export function BusinessForm({ action, words, name, town, languages, choices, owner = null, usedIn = [] }: { action: (prev: State, formData: FormData) => Promise<State>; words: BusinessWords; name: string; town: string; languages: readonly string[]; choices: readonly CallLang[]; owner?: OwnerFields | null; usedIn?: readonly string[] }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const w = (key: string) => words[key] ?? key;
  const lines = usedIn.length > 0 ? [...new Set(usedIn.map((u) => USED[u]).filter((n): n is string => n !== undefined))].sort() : ["1", "2", "3"];
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
      {owner && owner.groups.length > 0 ? (
        <div data-part="biz-type">
          <TypeCombobox groups={owner.groups} words={owner.typeWords} otherId={owner.otherId} initial={owner.type} otherInitial={owner.typeLabel} />
          <p className={help}>{w("settings.biz.type.note")}</p>
        </div>
      ) : null}
      <div>
        <label htmlFor="biz-town" className={label}>
          {w("settings.biz.town")}
        </label>
        <input id="biz-town" name="town" minLength={2} maxLength={80} defaultValue={town} autoComplete="address-level2" disabled={pending} className={field} />
      </div>
      {owner ? (
        <div>
          <label htmlFor="biz-phone" className={label}>
            {w("settings.biz.phone")}
          </label>
          <input id="biz-phone" name="phone" type="tel" inputMode="tel" maxLength={20} defaultValue={owner.phone} autoComplete="tel" disabled={pending} className={field} />
          <p className={help}>{w("settings.biz.phone.help")}</p>
        </div>
      ) : null}
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
          {lines.map((n) => (
            <li key={n}>{w(`settings.biz.used.${n}`)}</li>
          ))}
        </ul>
      </div>
    </form>
  );
}

type LogoState = { ok: true } | { ok: false; error: string } | undefined;

/**
 * The business logo (Settings > Business): the picture now set (or the business's first letter), a file choice (JPG, PNG or WebP, up to 5 MB, checked again by the API from the bytes) and "Remove logo". The Owner or an Admin changes it;
 * `action` is the server action bound to the workspace (a `logo` file, or `remove=1`).
 */
export function BusinessLogo({ action, words, logoUrl, initial }: { action: (prev: LogoState, formData: FormData) => Promise<LogoState>; words: BusinessWords; logoUrl: string | null; initial: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const w = (key: string) => words[key] ?? key;
  return (
    <div className="flex flex-col gap-3" data-part="biz-logo">
      <h3 className="text-base font-semibold">{w("settings.biz.logo.title")}</h3>
      <div className="flex items-center gap-4">
        <span className="inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-edge bg-surface-2 text-2xl font-semibold" aria-hidden="true">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed link into the project's own Storage (already allowed in img-src), shown as it is
            <img src={logoUrl} alt="" className="size-full object-cover" />
          ) : (
            initial
          )}
        </span>
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <label htmlFor="biz-logo-file" className="sr-only">
            {w("settings.biz.logo.choose")}
          </label>
          <input id="biz-logo-file" name="logo" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} className="max-w-full text-sm" />
          <button type="submit" disabled={pending} className={primary}>
            {w("settings.biz.logo.save")}
          </button>
        </form>
        {logoUrl ? (
          <form action={formAction}>
            <input type="hidden" name="remove" value="1" />
            <button type="submit" disabled={pending} className={secondary}>
              {w("settings.biz.logo.remove")}
            </button>
          </form>
        ) : null}
      </div>
      <p className={help}>{w("settings.biz.logo.help")}</p>
      {state && !state.ok ? (
        <p role="alert" className={errorLine}>
          {w(`settings.biz.logo.err.${state.error}`)}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className={okLine}>
          {w("settings.biz.logo.saved")}
        </p>
      ) : null}
    </div>
  );
}
