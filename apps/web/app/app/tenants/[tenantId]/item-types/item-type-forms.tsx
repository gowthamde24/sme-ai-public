"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";

import type { ItemType } from "@/lib/api/item-types";

import type { ItemTypeState } from "./item-types-actions";
import { CODE_SENTENCE, MAX_NAME, paiseToRupeesText } from "./item-types-logic";

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
      <div role="alert" className="error hint">
        <p>{state.error}</p>
        {state.reason === "mfa" ? (
          <p>
            <Link href="/app/security" className="tap">
              Open the Security page →
            </Link>
          </p>
        ) : null}
      </div>
    );
  if (state?.ok && state.message)
    return (
      <p role="status" className="hint">
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
    <form onSubmit={send(formAction)} noValidate className="card" style={{ maxWidth: "36rem" }} aria-labelledby="add-item-type-title">
      <h3 id="add-item-type-title" style={{ margin: 0 }}>
        Add an item type
      </h3>
      <p className="hint">{CODE_SENTENCE}</p>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <label htmlFor="it-name">Name</label>
        <input id="it-name" name="name" maxLength={MAX_NAME} autoComplete="off" required />
        <label htmlFor="it-code">Code</label>
        <input id="it-code" name="code" maxLength={20} autoComplete="off" required aria-describedby="it-code-hint" />
        <p id="it-code-hint" className="hint">
          A short label such as A1 or 07. Letters, digits, hyphens and underscores only. Typed once, never changed.
        </p>
        <label htmlFor="it-position">Position in the list (0 comes first)</label>
        <input id="it-position" name="position" inputMode="numeric" autoComplete="off" required />
        <label htmlFor="it-lowest">Lowest price in rupees (optional)</label>
        <input id="it-lowest" name="lowest" inputMode="decimal" autoComplete="off" />
        <label htmlFor="it-highest">Highest price in rupees (optional)</label>
        <input id="it-highest" name="highest" inputMode="decimal" autoComplete="off" />
      </fieldset>
      <button type="submit" disabled={pending}>
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
    <form onSubmit={send(formAction)} noValidate>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <p className="hint">
          Code <strong className="plain-text">{type.code}</strong> can never be changed.
        </p>
        <label htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} name="name" defaultValue={type.name} maxLength={MAX_NAME} autoComplete="off" required />
        <label htmlFor={`${id}-position`}>Position in the list (0 comes first)</label>
        <input id={`${id}-position`} name="position" defaultValue={String(type.position)} inputMode="numeric" autoComplete="off" required />
        <label>
          <input type="checkbox" name="active" defaultChecked={type.active} /> Can be used on a new quote
        </label>
        <label htmlFor={`${id}-lowest`}>Lowest price in rupees (optional)</label>
        <input id={`${id}-lowest`} name="lowest" defaultValue={paiseToRupeesText(type.min_price_paise)} inputMode="decimal" autoComplete="off" />
        <label htmlFor={`${id}-highest`}>Highest price in rupees (optional)</label>
        <input id={`${id}-highest`} name="highest" defaultValue={paiseToRupeesText(type.max_price_paise)} inputMode="decimal" autoComplete="off" />
      </fieldset>
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save changes"}
      </button>
      <Result state={state} />
    </form>
  );
}
