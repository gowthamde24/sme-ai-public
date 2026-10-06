"use client";

import { useActionState } from "react";

import { CUSTOMER_KINDS, CUSTOMER_KIND_LABELS } from "@/lib/api/quotes";

import { ActionResult } from "./action-result";
import type { QuoteActionState } from "./quote-actions";

type Action = (prev: QuoteActionState, formData: FormData) => Promise<QuoteActionState>;

/**
 * Make a DRAFT quote from the approved requirement and the products a person chose. The two choices below are the person's own words: whether the customer
 * is new or a repeat customer (nobody verifies this, so a repeat customer's quote needs the owner), and where it is delivered. The prices are not typed
 * here: they come from the price list and are computed by the engine, then checked by the database.
 */
export function CreateQuoteForm({ create, quoteId, states }: { create: Action; quoteId: string; states: Record<string, string> }) {
  const [state, formAction, pending] = useActionState(create, undefined);
  const options = Object.entries(states).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <form action={formAction} className="card" style={{ maxWidth: "36rem" }}>
      <input type="hidden" name="quote_id" value={quoteId} />
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>The customer</legend>
        {CUSTOMER_KINDS.map((kind) => (
          <label key={kind} style={{ display: "block" }}>
            <input type="radio" name="customer_kind" value={kind} defaultChecked={kind === "new"} /> {CUSTOMER_KIND_LABELS[kind]}
          </label>
        ))}
        <p className="hint">A repeat customer is your word: nobody has verified it, so the owner decides such a quote.</p>
      </fieldset>
      <label htmlFor="quote-state">Delivery state</label>
      <select id="quote-state" name="delivery_state" defaultValue="" required disabled={pending}>
        <option value="" disabled>
          Choose a state or union territory
        </option>
        {options.map(([code, name]) => (
          <option key={code} value={code}>
            {name} ({code})
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending}>
        {pending ? "Making the draft..." : "Make draft quote"}
      </button>
      <p className="hint">This makes a draft. Nothing is approved and nothing is sent.</p>
      <ActionResult state={state} />
    </form>
  );
}
