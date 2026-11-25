"use client";

import { useActionState, useId } from "react";

import { alertBox, btnMain, fieldInput, fieldLabel, formCard } from "@/components/v2/app/ui";

import { TypeSearch } from "@/components/v2/app/start/TypeSearch";
import type { TypeRow } from "@/lib/packs/type-search";
import { makeT, type Words } from "@/components/v2/app/words";

import { createTenantAction, type TenantFormState } from "./actions";

export type { TypeRow };

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
          <TypeSearch choices={types} words={words} name="pack" required />
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
