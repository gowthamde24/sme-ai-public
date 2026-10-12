"use client";

import { useActionState } from "react";

import { CUSTOMER_KINDS } from "@/lib/api/quotes";

import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, checkBox, fieldInput, fieldLabel, fieldsetPlain, formCardWide, legendText, mutedText, radioRow } from "@/components/v2/app/ui";
import type { QuoteActionState } from "./quote-actions";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: QuoteActionState, formData: FormData) => Promise<QuoteActionState>;

/**
 * Make a DRAFT quote from the approved requirement and the products a person chose. The two choices below are the person's own words: whether the customer
 * is new or a repeat customer (nobody verifies this, so a repeat customer's quote needs the owner), and where it is delivered. The prices are not typed
 * here: they come from the price list and are computed by the engine, then checked by the database.
 */
export function CreateQuoteForm({ create, quoteId, states, words }: { create: Action; quoteId: string; states: Record<string, string>; words?: Words; }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(create, undefined);
  const options = Object.entries(states).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <form action={formAction} className={formCardWide}>
      <input type="hidden" name="quote_id" value={quoteId} />
      <fieldset disabled={pending} className={fieldsetPlain}>
        <legend className={legendText}>{t("enq.the_customer")}</legend>
        {CUSTOMER_KINDS.map((kind) => (
          <label key={kind} className={radioRow}>
            <input type="radio" name="customer_kind" value={kind} defaultChecked={kind === "new"} className={checkBox} /> {t(`enq.kind.${kind}`)}
          </label>
        ))}
        <p className={mutedText}>{t("enq.a_repeat_customer_is_your_word")}</p>
      </fieldset>
      <label htmlFor="quote-state" className={fieldLabel}>
        {t("enq.delivery_state")}
      </label>
      <select id="quote-state" name="delivery_state" defaultValue="" required disabled={pending} className={fieldInput}>
        <option value="" disabled>
          {t("enq.choose_a_state_or_union_territory")}
        </option>
        {options.map(([code, name]) => (
          <option key={code} value={code}>
            {name} ({code})
          </option>
        ))}
      </select>
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("enq.making_the_draft") : t("enq.make_draft_quote")}
      </button>
      <p className={mutedText}>{t("enq.this_makes_a_draft_nothing_is")}</p>
      <ActionResultV2 state={state} />
    </form>
  );
}
