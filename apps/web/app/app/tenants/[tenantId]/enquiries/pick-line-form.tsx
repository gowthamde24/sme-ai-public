"use client";

import { useActionState } from "react";

import { formatRupees, type PriceItem, type SetupLine } from "@/lib/api/quotes";

import { ActionResult } from "./action-result";
import type { QuoteActionState } from "./quote-actions";

type Action = (prev: QuoteActionState, formData: FormData) => Promise<QuoteActionState>;

const SUGGESTION_WORDS: Record<string, string> = {
  matched: "The assistant suggests this product. It is only a suggestion: you choose.",
  ambiguous: "Several products could match. The assistant did not choose: you do.",
  unmatched: "No product on the price list matched. Choose one by hand.",
  needs_human: "The assistant could not decide. Choose one by hand.",
  needs_input: "More detail is needed to suggest a product. Choose one by hand.",
};

const optionText = (item: PriceItem) => `${item.name} (${item.sku}): ${formatRupees(item.unit_price_paise)} per ${item.sale_unit}`;

/**
 * Choose the product ONE requirement line means. The assistant's suggestions come first and are only ever suggestions: nothing is chosen until a
 * person presses the button. The quantity starts as the enquiry's; the database refuses one that changes the customer's own unless the unit differs.
 */
export function PickLineForm({ pick, line, priceList }: { pick: Action; line: SetupLine; priceList: PriceItem[] }) {
  const [state, formAction, pending] = useActionState(pick, undefined);
  const suggested = line.suggestion?.candidates ?? [];
  const suggestedIds = new Set(suggested.map((c) => c.product_id));
  const chosen = line.pick ? priceList.find((p) => p.product_id === line.pick?.product_id) : undefined;
  const current = line.pick ? `${suggestedIds.has(line.pick.product_id) ? "suggested" : "list"}:${line.pick.product_id}:${line.pick.sale_unit}` : "";
  const id = `pick-${line.line_no}`;
  return (
    <form action={formAction} className="card" style={{ maxWidth: "40rem" }}>
      <h4 style={{ margin: 0 }}>Line {line.line_no}</h4>
      <ul className="plain-text" style={{ margin: "0.25rem 0" }}>
        {line.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {chosen ? (
        <p role="status">
          Chosen: <strong className="plain-text">{chosen.name}</strong> × {line.pick?.qty} {line.pick?.sale_unit}
          {line.pick?.source === "mapper_suggestion" ? " (from the assistant's suggestion, confirmed by a person)" : " (chosen by hand)"}
        </p>
      ) : (
        <p className="hint">No product chosen yet.</p>
      )}
      {line.suggestion ? <p className="hint">{SUGGESTION_WORDS[line.suggestion.status]}{line.suggestion.truncated ? " Only the first candidates are shown." : ""}</p> : null}
      <label htmlFor={`${id}-choice`}>Product</label>
      <select id={`${id}-choice`} name="choice" defaultValue={current} required disabled={pending}>
        <option value="" disabled>
          Choose a product
        </option>
        {suggested.length > 0 ? (
          <optgroup label="Suggested for this line">
            {suggested.map((item) => (
              <option key={`s-${item.product_id}`} value={`suggested:${item.product_id}:${item.sale_unit}`}>
                {optionText(item)}
              </option>
            ))}
          </optgroup>
        ) : null}
        <optgroup label="The whole price list">
          {priceList
            .filter((item) => !suggestedIds.has(item.product_id))
            .map((item) => (
              <option key={`l-${item.product_id}`} value={`list:${item.product_id}:${item.sale_unit}`}>
                {optionText(item)}
              </option>
            ))}
        </optgroup>
      </select>
      <label htmlFor={`${id}-qty`}>Quantity to quote</label>
      <input id={`${id}-qty`} name="qty" type="number" inputMode="numeric" min={1} max={10000} step={1} defaultValue={line.pick?.qty ?? line.quantity ?? ""} required disabled={pending} />
      <p className="hint">
        The enquiry asked for {line.quantity} {line.basis ?? "piece"}. If the price list sells this product in a different unit (pieces or sets), enter the converted count.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : line.pick ? "Change the product" : "Use this product"}
      </button>
      <ActionResult state={state} />
    </form>
  );
}
