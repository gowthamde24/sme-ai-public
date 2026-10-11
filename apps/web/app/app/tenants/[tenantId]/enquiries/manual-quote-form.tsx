"use client";

import { startTransition, useActionState, useState } from "react";

import { makeT, type Words } from "@/components/v2/app/words";
import type { ItemType } from "@/lib/api/item-types";
import { CUSTOMER_KINDS, formatBps, formatDate } from "@/lib/api/quotes";

import { alertBox, btnMain, btnQuiet, checkBox, fieldBlock, fieldHelp, fieldInput, fieldLabel, fieldsetLine, fieldsetPlain, formCardWide, legendText, lineGrid, mutedText, noteBox, pageH3, radioRow } from "@/components/v2/app/ui";

import type { ManualQuoteState } from "./manual-quote-actions";
import { CHOOSE_KIND, EMPTY_LINE, LINE_TEXT, MAX_LINES, RANGE_NOTE, linesFromForm, showRangeNote, type LineValues } from "./manual-quote-logic";

type Action = (prev: ManualQuoteState, formData: FormData) => Promise<ManualQuoteState>;

/** The GST rate in force today (read-only: the policy decides it) or why there is none. */
export type GstInForce = { rateBps: number; from: string };

export const NO_RATE_TEXT = "A quote with typed prices needs a quote policy in force with a GST rate that applies today.";

type Props = {
  create: Action;
  quoteId: string;
  /** The ACTIVE item types, in the owner's display order. */
  itemTypes: ItemType[];
  gst: GstInForce | null;
  words?: Words;
};

/**
 * A quote with typed prices (owner or admin). It does not ask where the goods are delivered (owner decision: a quote with typed prices has no delivery state). A person chooses an item type, a quantity and a price for each line, in rupees; the price is converted to integer paise by
 * reading the text and nothing here works out GST or a total: the engine and the database do, and the database decides. A price outside the item type's usual range gets a
 * neutral note and never stops the form. The id comes from the page (one per render), so pressing again after a failure is a retry that replays, not a second quote.
 * Held in state and sent with onSubmit, so a refusal keeps what the person typed.
 */
export function ManualQuoteForm({ create, quoteId, itemTypes, gst, words }: Props) {
  const t = makeT(words);
  const [lines, setLines] = useState<LineValues[]>([{ ...EMPTY_LINE }]);
  const [kind, setKind] = useState<string>("new");
  const [localError, setLocalError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(create, undefined);
  const noRate = gst === null;
  const blocked = state?.blocked === true;
  const error = localError ?? state?.error ?? null;
  const change = (index: number, field: keyof LineValues, value: string) => setLines((current) => current.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  return (
    <form
      noValidate
      className={formCardWide}
      aria-labelledby="manual-quote-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (noRate || blocked) return;
        if (!(CUSTOMER_KINDS as readonly string[]).includes(kind)) {
          setLocalError(CHOOSE_KIND);
          return;
        }
        const checked = linesFromForm(lines);
        if (!checked.ok) {
          setLocalError(checked.error);
          return;
        }
        setLocalError(null);
        startTransition(() => formAction(new FormData(event.currentTarget)));
      }}
    >
      <h3 id="manual-quote-title" className={pageH3}>
        {t("enq.quote_with_typed_prices")}
      </h3>
      <p className={mutedText}>
        {t("enq.you_type_the_price_of_each")}
      </p>
      {gst ? (
        <p>
          {t("enq.gst_rate")} <strong>{formatBps(gst.rateBps)}</strong>, {t("enq.from")} {formatDate(gst.from)}{t("enq.gst_added_on_top")}
        </p>
      ) : (
        <p role="note" className={noteBox}>
          {NO_RATE_TEXT}
        </p>
      )}
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="line_count" value={lines.length} />

      <fieldset disabled={pending} className={fieldsetPlain}>
        <legend className={legendText}>{t("enq.the_customer")}</legend>
        {CUSTOMER_KINDS.map((k) => (
          <label key={k} className={radioRow}>
            <input type="radio" name="customer_kind" value={k} checked={kind === k} onChange={() => setKind(k)} className={checkBox} /> {t(`enq.kind.${k}`)}
          </label>
        ))}
        <p className={mutedText}>{t("enq.a_repeat_customer_is_your_word")}</p>
      </fieldset>

      {lines.map((line, index) => {
        const n = index + 1;
        return (
          <fieldset key={n} disabled={pending} className={fieldsetLine}>
            <legend className={legendText}>{t("enq.line_n", { n })}</legend>
            <div className={lineGrid}>
              <div className={fieldBlock}>
                <label htmlFor={`mq-code-${n}`} className={fieldLabel}>
                  {t("enq.item_type")}
                </label>
                <select id={`mq-code-${n}`} className={fieldInput} name={`code_${n}`} value={line.code} onChange={(e) => change(index, "code", e.target.value)}>
                  <option value="">{t("enq.choose_an_item_type")}</option>
                  {itemTypes.map((it) => (
                    <option key={it.code} value={it.code}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={fieldBlock}>
                <label htmlFor={`mq-qty-${n}`} className={fieldLabel}>
                  {t("enq.quantity_pieces")}
                </label>
                <input id={`mq-qty-${n}`} className={fieldInput} name={`qty_${n}`} inputMode="numeric" autoComplete="off" value={line.qty} onChange={(e) => change(index, "qty", e.target.value)} />
              </div>
              <div className={fieldBlock}>
                <label htmlFor={`mq-price-${n}`} className={fieldLabel}>
                  {t("enq.price_per_piece_rupees")}
                </label>
                <input
                  id={`mq-price-${n}`}
                  className={fieldInput}
                  name={`price_${n}`}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-describedby={`mq-price-hint-${n}`}
                  value={line.price}
                  onChange={(e) => change(index, "price", e.target.value)}
                />
              </div>
            </div>
            <p id={`mq-price-hint-${n}`} className={fieldHelp}>
              {LINE_TEXT.price}
            </p>
            {showRangeNote(line, itemTypes) ? (
              <p role="note" className={noteBox}>
                {RANGE_NOTE}
              </p>
            ) : null}
            {lines.length > 1 ? (
              <button type="button" className={btnQuiet} onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                {t("enq.remove_line_n", { n })}
              </button>
            ) : null}
          </fieldset>
        );
      })}

      <p>
        <button type="button" className={btnQuiet} disabled={pending || lines.length >= MAX_LINES} onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>
          {t("enq.add_a_line")}
        </button>
        {lines.length >= MAX_LINES ? <span className={mutedText}> {t("enq.a_quote_has_at_most_5")}</span> : null}
      </p>

      {error ? (
        <p role="alert" className={alertBox}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={btnMain} disabled={pending || noRate || blocked}>
        {pending ? t("enq.making_the_draft") : t("enq.make_draft_quote")}
      </button>
    </form>
  );
}
