"use client";

import { useActionState, useId } from "react";

import { alertBox, btnMain, fieldInput, fieldLabel, formCard } from "@/components/v2/app/ui";

import { makeT, type Words } from "@/components/v2/app/words";

import { createTenantAction, type TenantFormState } from "./actions";

export type TypeRow = { id: string; name: string; line: string };

export function CreateTenantForm({ words, types = [] }: { words?: Words; /** FIRST_RUN_TYPE: the business types (plain rows) asked before the workspace is made; empty = the form as it was */ types?: readonly TypeRow[] }) {
  const t = makeT(words);
  // the form is drawn in the side menu and on /app, so two can be open at once: each needs ids of its own (the name= attributes stay as they are)
  const uid = useId();
  const nameId = `${uid}-name`;
  const slugId = `${uid}-slug`;
  const [state, action, pending] = useActionState<TenantFormState, FormData>(
    createTenantAction,
    undefined,
  );
  return (
    <form className={formCard} action={action}>
      <label htmlFor={nameId} className={fieldLabel}>
        {t("acct.workspace_name")}
      </label>
      <input id={nameId} className={fieldInput} name="name" required maxLength={120} />
      <label htmlFor={slugId} className={fieldLabel}>
        {t("acct.url_name")}
      </label>
      <input
        id={slugId}
        className={fieldInput}
        name="slug"
        required
        minLength={3}
        maxLength={40}
        pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
        placeholder="my-business"
      />
      {types.length > 0 ? (
        <fieldset data-part="create-type" className="m-0 mt-2 min-w-0 border-0 p-0">
          <legend className={fieldLabel}>{t("start.type.title")}</legend>
          <div role="radiogroup" aria-label={t("start.type.title")} className="flex flex-col border-t border-ink">
            {types.map((p) => (
              <label key={p.id} data-type={p.id} className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-line py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold text-ink">{p.name}</span>
                  {p.line ? <span className="block text-sm text-muted">{p.line}</span> : null}
                </span>
                <input type="radio" name="pack" value={p.id} required className="size-5 shrink-0 accent-[var(--v2-ink)]" />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {t("acct.create_workspace")}
      </button>
    </form>
  );
}
