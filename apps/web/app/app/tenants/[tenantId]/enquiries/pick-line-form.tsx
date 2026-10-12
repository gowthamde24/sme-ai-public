"use client";

import { useActionState } from "react";

import { formatRupees, type PriceItem, type SetupLine } from "@/lib/api/quotes";

import { ActionResultV2 } from "@/components/v2/app/parts";
import { bulletList, btnMain, fieldInput, fieldLabel, formCardWide, mutedText, noteBox, pageH4, plainText } from "@/components/v2/app/ui";
import type { QuoteActionState } from "./quote-actions";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: QuoteActionState, formData: FormData) => Promise<QuoteActionState>;

const optionText = (item: PriceItem) => `${item.name} (${item.sku}): ${formatRupees(item.unit_price_paise)} per ${item.sale_unit}`;

/**
 * Choose the product ONE requirement line means. The assistant's suggestions come first and are only ever suggestions: nothing is chosen until a
 * person presses the button. The quantity starts as the enquiry's; the database refuses one that changes the customer's own unless the unit differs.
 */
export function PickLineForm({ pick, line, priceList, words }: { pick: Action; line: SetupLine; priceList: PriceItem[]; words?: Words; }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(pick, undefined);
  const suggested = line.suggestion?.candidates ?? [];
  const suggestedIds = new Set(suggested.map((c) => c.product_id));
  const chosen = line.pick ? priceList.find((p) => p.product_id === line.pick?.product_id) : undefined;
  const current = line.pick ? `${suggestedIds.has(line.pick.product_id) ? "suggested" : "list"}:${line.pick.product_id}:${line.pick.sale_unit}` : "";
  const id = `pick-${line.line_no}`;
  return (
    <form action={formAction} className={formCardWide}>
      <h4 className={pageH4}>{t("enq.line_n", { n: line.line_no })}</h4>
      <ul className={`${bulletList} ${plainText}`}>
        {line.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {chosen ? (
        <p role="status" className={noteBox}>
          {t("enq.chosen")} <strong className={plainText}>{chosen.name}</strong> × {line.pick?.qty} {line.pick?.sale_unit}
          {line.pick?.source === "mapper_suggestion" ? ` ${t("enq.from_assistant")}` : ` ${t("enq.by_hand")}`}
        </p>
      ) : (
        <p className={mutedText}>{t("enq.no_product_chosen_yet")}</p>
      )}
      {line.suggestion ? <p className={mutedText}>{t(`enq.sug.${line.suggestion.status}`)}{line.suggestion.truncated ? t("enq.only_the_first_candidates_are_shown") : ""}</p> : null}
      <label htmlFor={`${id}-choice`} className={fieldLabel}>
        {t("enq.product")}
      </label>
      <select id={`${id}-choice`} name="choice" defaultValue={current} required disabled={pending} className={fieldInput}>
        <option value="" disabled>
          {t("enq.choose_a_product")}
        </option>
        {suggested.length > 0 ? (
          <optgroup label={t("enq.suggested_for_line")}>
            {suggested.map((item) => (
              <option key={`s-${item.product_id}`} value={`suggested:${item.product_id}:${item.sale_unit}`}>
                {optionText(item)}
              </option>
            ))}
          </optgroup>
        ) : null}
        <optgroup label={t("enq.whole_price_list")}>
          {priceList
            .filter((item) => !suggestedIds.has(item.product_id))
            .map((item) => (
              <option key={`l-${item.product_id}`} value={`list:${item.product_id}:${item.sale_unit}`}>
                {optionText(item)}
              </option>
            ))}
        </optgroup>
      </select>
      <label htmlFor={`${id}-qty`} className={fieldLabel}>
        {t("enq.quantity_to_quote")}
      </label>
      <input id={`${id}-qty`} className={fieldInput} name="qty" type="number" inputMode="numeric" min={1} max={10000} step={1} defaultValue={line.pick?.qty ?? line.quantity ?? ""} required disabled={pending} />
      <p className={mutedText}>
        {t("enq.asked_for_unit", { qty: line.quantity ?? "", unit: line.basis ?? "piece" })}
      </p>
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("orders.saving") : line.pick ? t("enq.change_product") : t("enq.use_product")}
      </button>
      <ActionResultV2 state={state} />
    </form>
  );
}
