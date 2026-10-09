"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";

import type { ItemType } from "@/lib/api/item-types";

import type { ItemTypeState } from "./item-types-actions";
import { CODE_SENTENCE, MAX_NAME, paiseToRupeesText } from "./item-types-logic";
import { alertBox, btnMain, checkBox, checkRow, colSpanFull, fieldBlock, fieldHelp, fieldInput, fieldLabel, fieldsetPlain, formCard, formCol, formGrid, formTitle, link, mutedText, okBox, plainText } from "@/components/v2/app/ui";

type Action = (prev: ItemTypeState, formData: FormData) => Promise<ItemTypeState>;

/** The form is sent through a transition (as the quote policy form does), so the sentence that comes back is shown and what was typed stays when the server refuses. */
const send = (formAction: (data: FormData) => void) => (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  startTransition(() => formAction(data));
};

function Result({ state }: { state: ItemTypeState }) {
  if (state?.error)
    return (
      <div role="alert" className={alertBox}>
        <p>{state.error}</p>
        {state.reason === "mfa" ? (
          <p>
            <Link href="/app/security" className={link}>
              Open the Security page →
            </Link>
          </p>
        ) : null}
      </div>
    );
  if (state?.ok && state.message)
    return (
      <p role="status" className={okBox}>
        {state.message}
      </p>
    );
  return null;
}

/**
 * Add an item type. Every field starts empty (there is no default of ours) except the order, which has no sensible default either, so it starts empty too. The code is typed once and
 * can never be changed; a type can never be deleted, only switched off. Prices are typed in rupees and read exactly: the server checks everything again.
 */
export function AddItemTypeForm({ add }: { add: Action }) {
  const [state, formAction, pending] = useActionState(add, undefined);
  return (
    <form onSubmit={send(formAction)} noValidate className={formCard} aria-labelledby="add-item-type-title">
      <h3 id="add-item-type-title" className={formTitle}>
        Add an item type
      </h3>
      <p className={mutedText}>{CODE_SENTENCE}</p>
      <fieldset disabled={pending} className={fieldsetPlain}>
        <div className={formGrid}>
          <div className={`${fieldBlock} ${colSpanFull}`}>
            <label htmlFor="it-name" className={fieldLabel}>
              Name
            </label>
            <input id="it-name" className={fieldInput} name="name" maxLength={MAX_NAME} autoComplete="off" required />
          </div>
          <div className={fieldBlock}>
            <label htmlFor="it-code" className={fieldLabel}>
              Code
            </label>
            <input id="it-code" className={fieldInput} name="code" maxLength={20} autoComplete="off" required aria-describedby="it-code-hint" />
            <p id="it-code-hint" className={fieldHelp}>
              A short label such as A1 or 07. Letters, digits, hyphens and underscores only. Typed once, never changed.
            </p>
          </div>
          <div className={fieldBlock}>
            <label htmlFor="it-position" className={fieldLabel}>
              Position in the list (0 comes first)
            </label>
            <input id="it-position" className={fieldInput} name="position" inputMode="numeric" autoComplete="off" required />
          </div>
          <div className={fieldBlock}>
            <label htmlFor="it-lowest" className={fieldLabel}>
              Lowest price in rupees (optional)
            </label>
            <input id="it-lowest" className={fieldInput} name="lowest" inputMode="decimal" autoComplete="off" />
          </div>
          <div className={fieldBlock}>
            <label htmlFor="it-highest" className={fieldLabel}>
              Highest price in rupees (optional)
            </label>
            <input id="it-highest" className={fieldInput} name="highest" inputMode="decimal" autoComplete="off" />
          </div>
        </div>
      </fieldset>
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Adding..." : "Add this item type"}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Change an item type: its name, its place in the list, whether it can be used on a new quote, and its optional lowest and highest price. The code is shown and cannot be edited. */
export function EditItemTypeForm({ type, save }: { type: ItemType; save: Action }) {
  const [state, formAction, pending] = useActionState(save, undefined);
  const id = `it-${type.code}`;
  return (
    <form onSubmit={send(formAction)} noValidate className={formCol}>
      <fieldset disabled={pending} className={fieldsetPlain}>
        <p className={mutedText}>
          Code <strong className={plainText}>{type.code}</strong> can never be changed.
        </p>
        <div className={formGrid}>
          <div className={`${fieldBlock} ${colSpanFull}`}>
            <label htmlFor={`${id}-name`} className={fieldLabel}>
              Name
            </label>
            <input id={`${id}-name`} className={fieldInput} name="name" defaultValue={type.name} maxLength={MAX_NAME} autoComplete="off" required />
          </div>
          <div className={fieldBlock}>
            <label htmlFor={`${id}-position`} className={fieldLabel}>
              Position in the list (0 comes first)
            </label>
            <input id={`${id}-position`} className={fieldInput} name="position" defaultValue={String(type.position)} inputMode="numeric" autoComplete="off" required />
          </div>
          <div className={fieldBlock}>
            <label htmlFor={`${id}-lowest`} className={fieldLabel}>
              Lowest price in rupees (optional)
            </label>
            <input id={`${id}-lowest`} className={fieldInput} name="lowest" defaultValue={paiseToRupeesText(type.min_price_paise)} inputMode="decimal" autoComplete="off" />
          </div>
          <div className={fieldBlock}>
            <label htmlFor={`${id}-highest`} className={fieldLabel}>
              Highest price in rupees (optional)
            </label>
            <input id={`${id}-highest`} className={fieldInput} name="highest" defaultValue={paiseToRupeesText(type.max_price_paise)} inputMode="decimal" autoComplete="off" />
          </div>
          <div className={colSpanFull}>
            <label className={checkRow}>
              <input type="checkbox" name="active" defaultChecked={type.active} className={checkBox} /> Can be used on a new quote
            </label>
          </div>
        </div>
      </fieldset>
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Saving..." : "Save changes"}
      </button>
      <Result state={state} />
    </form>
  );
}
