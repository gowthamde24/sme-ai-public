"use client";

import { useActionState, useState, type ReactNode } from "react";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { card, sectionTitle } from "../v6/ui";
import { makeT, type Words } from "../words";

type State = { ok: true } | { ok: false; error: string } | undefined;

/**
 * The Business card of Settings (design system v6): the name and the city or area with ONE Edit; Edit opens the two fields in place with one "Publish" (the same save as Settings > Business: `saveBusinessAction`), which keeps the languages as they are. The other rows (timings, GST,
 * logo) arrive as `children`, each with its own Edit to the screen that already does it. `save` is the server action bound to the workspace; a refusal shows the closed sentence of Settings > Business.
 */
export function BusinessCardV6({ words, name, city, languages, canEdit, save, children }: { words: Words; name: string; city: string | null; languages: readonly string[]; canEdit: boolean; save: (prev: State, formData: FormData) => Promise<State>; children?: ReactNode }) {
  const t = makeT(words);
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(async (prev: State, formData: FormData) => {
    const result = await save(prev, formData);
    if (result?.ok) setOpen(false);
    return result;
  }, undefined);
  return (
    <section aria-labelledby="sv6-business" data-part="settings-business" className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="sv6-business" className={sectionTitle}>
          {t("sv6.biz.title")}
        </h2>
        {canEdit && !open ? (
          <button type="button" onClick={() => setOpen(true)} aria-label={t("sv6.edit.for", { what: t("sv6.biz.title") })} className={btnQuiet} data-part="business-edit">
            {t("today.act.edit")}
          </button>
        ) : null}
      </div>
      {open ? (
        <form action={run} className="mt-3 flex flex-col gap-3" data-part="business-form">
          <div>
            <label htmlFor="sv6-name" className={fieldLabel}>
              {t("settings.biz.name")}
            </label>
            <input id="sv6-name" name="name" required maxLength={120} defaultValue={name} autoComplete="organization" disabled={pending} className={fieldInput} />
          </div>
          <div>
            <label htmlFor="sv6-town" className={fieldLabel}>
              {t("settings.biz.town")}
            </label>
            <input id="sv6-town" name="town" minLength={2} maxLength={80} defaultValue={city ?? ""} autoComplete="address-level2" disabled={pending} className={fieldInput} />
          </div>
          {languages.map((l) => (
            <input key={l} type="hidden" name="languages" value={l} />
          ))}
          {state && !state.ok ? (
            <p role="alert" className="text-sm font-semibold text-red-text">
              {t(`settings.biz.err.${state.error}`)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={btnMain}>
              {t("catalogue.v6.publish")}
            </button>
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className={btnQuiet}>
              {t("today.act.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-2 divide-y divide-line">
          <div className="py-2.5">
            <dt className="text-sm text-muted">{t("settings.biz.name")}</dt>
            <dd className="min-w-0 break-words text-base font-semibold" data-part="business-name">
              {name}
            </dd>
          </div>
          <div className="py-2.5">
            <dt className="text-sm text-muted">{t("settings.biz.town")}</dt>
            <dd className={`min-w-0 break-words text-base ${city ? "font-semibold" : "text-muted"}`} data-part="business-city">
              {city ?? t("sv6.na")}
            </dd>
          </div>
        </dl>
      )}
      {state?.ok && !open ? (
        <p role="status" className="mt-2 text-sm font-semibold text-green-text">
          {t("sv6.biz.published")}
        </p>
      ) : null}
      {children}
    </section>
  );
}
