"use client";

import { startTransition, useActionState, useState } from "react";

import type { ItemType } from "@/lib/api/item-types";
import { CUSTOMER_KINDS, CUSTOMER_KIND_LABELS, formatBps, formatDate } from "@/lib/api/quotes";

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
};

/**
 * A quote with typed prices (owner or admin). It does not ask where the goods are delivered (owner decision: a quote with typed prices has no delivery state). A person chooses an item type, a quantity and a price for each line, in rupees; the price is converted to integer paise by
 * reading the text and nothing here works out GST or a total: the engine and the database do, and the database decides. A price outside the item type's usual range gets a
 * neutral note and never stops the form. The id comes from the page (one per render), so pressing again after a failure is a retry that replays, not a second quote.
 * Held in state and sent with onSubmit, so a refusal keeps what the person typed.
 */
export function ManualQuoteForm({ create, quoteId, itemTypes, gst }: Props) {
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
      className="card"
      style={{ maxWidth: "40rem" }}
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
      <h3 id="manual-quote-title" style={{ margin: 0 }}>
        Quote with typed prices
      </h3>
      <p className="hint">
        You type the price of each piece. The GST and the totals are worked out for you, and the owner approves the draft before it can be used. Nothing is sent.
      </p>
      {gst ? (
        <p>
          GST rate: <strong>{formatBps(gst.rateBps)}</strong>, from {formatDate(gst.from)}, added on top of every price you type. It comes from the quote policy.
        </p>
      ) : (
        <p role="note" className="notice">
          {NO_RATE_TEXT}
        </p>
      )}
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="line_count" value={lines.length} />

      <fieldset disabled={pending} className="form-plain">
        <legend>The customer</legend>
        {CUSTOMER_KINDS.map((k) => (
          <label key={k} style={{ display: "block" }}>
            <input type="radio" name="customer_kind" value={k} checked={kind === k} onChange={() => setKind(k)} /> {CUSTOMER_KIND_LABELS[k]}
          </label>
        ))}
        <p className="hint">A repeat customer is your word: nobody has verified it, so the owner decides such a quote.</p>
      </fieldset>

      {lines.map((line, index) => {
        const n = index + 1;
        return (
          <fieldset key={n} disabled={pending} className="form-line">
            <legend>Line {n}</legend>
            <div className="form-grid line-grid">
              <div className="field">
                <label htmlFor={`mq-code-${n}`}>Item type</label>
                <select id={`mq-code-${n}`} name={`code_${n}`} value={line.code} onChange={(e) => change(index, "code", e.target.value)}>
                  <option value="">Choose an item type</option>
                  {itemTypes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`mq-qty-${n}`}>Quantity (pieces)</label>
                <input id={`mq-qty-${n}`} name={`qty_${n}`} inputMode="numeric" autoComplete="off" value={line.qty} onChange={(e) => change(index, "qty", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`mq-price-${n}`}>Price per piece (rupees)</label>
                <input
                  id={`mq-price-${n}`}
                  name={`price_${n}`}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-describedby={`mq-price-hint-${n}`}
                  value={line.price}
                  onChange={(e) => change(index, "price", e.target.value)}
                />
              </div>
            </div>
            <p id={`mq-price-hint-${n}`} className="hint">
              {LINE_TEXT.price}
            </p>
            {showRangeNote(line, itemTypes) ? (
              <p role="note" className="notice">
                {RANGE_NOTE}
              </p>
            ) : null}
            {lines.length > 1 ? (
              <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
                Remove line {n}
              </button>
            ) : null}
          </fieldset>
        );
      })}

      <p>
        <button type="button" disabled={pending || lines.length >= MAX_LINES} onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>
          Add a line
        </button>
        {lines.length >= MAX_LINES ? <span className="hint"> A quote has at most 5 lines.</span> : null}
      </p>

      {error ? (
        <p role="alert" className="error hint">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending || noRate || blocked}>
        {pending ? "Making the draft..." : "Make draft quote"}
      </button>
    </form>
  );
}
