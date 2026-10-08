import {
  CUSTOMER_KIND_LABELS,
  FLAG_TEXT,
  OUTCOME_LABELS,
  REJECT_LABELS,
  WITHDRAW_LABELS,
  formatBps,
  formatDate,
  formatRupees,
  isManual,
  type Quote,
} from "@/lib/api/quotes";

import { LocalTime } from "../../../local-time";

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "plain" | "warn" }) {
  const cls = tone === "good" ? "badge badge-good" : tone === "warn" ? "badge badge-maybe" : "badge";
  return <span className={cls}>{children}</span>;
}

const unitWord = (qty: number, unit: string) => `${qty} ${unit}${qty === 1 ? "" : "s"}`;

/**
 * One quote, every figure and every flag. The figures are the pricing engine's, verified again by the database: nothing on this screen was typed by a
 * person or worked out by a language model. Names and requirement text are plain text. A quote is a Draft until a person approves it; no quote here is ever
 * "Sent", because this application sends nothing. A quote whose prices a person typed (`pricing_kind` "manual") shows the item type's name and says the price was typed by a
 * person; it has no price list, and may have no delivery state, and those rows are left out. The internal line key (LINE-n) is never shown. A list-price quote renders exactly as before.
 */
export function QuoteView({ quote, stateName }: { quote: Quote; stateName: string }) {
  const flags = [...quote.engine_flags, ...quote.review_flags];
  const manual = isManual(quote);
  // a quote with typed prices has no freight line: its two freight rows are left out, unless the quote somehow carries freight money (then it is shown, never hidden)
  const showFreight = !manual || quote.shipping_net_paise !== 0 || quote.shipping_tax_paise !== 0;
  return (
    <div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Quote {quote.quote_no}</h3>
        <Badge tone={quote.outcome === "approved" ? "good" : quote.outcome === "draft" ? "warn" : "plain"}>{OUTCOME_LABELS[quote.outcome]}</Badge>
        {manual ? <Badge tone="plain">Typed prices</Badge> : null}
        {quote.needs_owner_approval ? <Badge tone="warn">Needs the owner&apos;s approval</Badge> : null}
      </div>

      {flags.length > 0 ? (
        <div role="note" className="notice">
          <strong>Please read before approving:</strong>
          <ul>
            {flags.map((flag) => (
              <li key={flag}>{FLAG_TEXT[flag] ?? "This quote carries a flag the owner must look at."}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="summary">
        <dt>Customer</dt>
        <dd>{CUSTOMER_KIND_LABELS[quote.customer_kind]}</dd>
        {quote.delivery_state !== null ? (
          <>
            <dt>Delivery</dt>
            <dd>
              <span className="plain-text">{stateName}</span> ({quote.delivery_state}), {quote.gst_supply === "intra_state" ? "the seller's own state" : "another state"}
            </dd>
          </>
        ) : null}
        <dt>Made on</dt>
        <dd>{formatDate(quote.as_of)}</dd>
        <dt>Valid until</dt>
        <dd>{formatDate(quote.valid_until)}</dd>
        <dt>Balance due by</dt>
        <dd>{formatDate(quote.due_date)}</dd>
      </dl>

      <h4>Lines</h4>
      <ul className="evidence-list">
        {quote.lines.map((line) => (
          <li key={line.line_no} className="evidence-item">
            <strong className="plain-text">{line.name}</strong>{" "}
            {manual ? <span className="hint">Price typed by a person</span> : <span className="hint">({line.sku}; requirement line {line.requirement_line_no})</span>}
            <dl>
              <dt>Quantity</dt>
              <dd>{unitWord(line.qty, line.sale_unit)}</dd>
              <dt>Price</dt>
              <dd>
                {formatRupees(line.unit_price_applied_paise)} each
                {line.price_break_min_qty !== null ? ` (the price for ${line.price_break_min_qty} or more)` : ""}
              </dd>
              <dt>Amount</dt>
              <dd>{formatRupees(line.net_paise)}</dd>
              <dt>GST ({formatBps(line.tax_bps)})</dt>
              <dd>{formatRupees(line.tax_paise)}</dd>
              <dt>Line total</dt>
              <dd>{formatRupees(line.gross_paise)}</dd>
            </dl>
          </li>
        ))}
      </ul>

      {quote.unquoted_lines.length > 0 ? (
        <div role="note" className="notice">
          <strong>Not in this quote</strong> (no saree type and quantity that a person approved):
          <ul>
            {quote.unquoted_lines.map((line) => (
              <li key={line.line_no} className="plain-text">
                Line {line.line_no}: {line.summary.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h4>Totals</h4>
      <dl className="summary">
        <dt>Goods</dt>
        <dd>{formatRupees(quote.merchandise_net_paise)}</dd>
        <dt>GST on goods</dt>
        <dd>{formatRupees(quote.item_tax_paise)}</dd>
        {showFreight ? (
          <>
            <dt>Freight</dt>
            <dd>{formatRupees(quote.shipping_net_paise)}</dd>
            <dt>GST on freight</dt>
            <dd>{formatRupees(quote.shipping_tax_paise)}</dd>
          </>
        ) : null}
        <dt>
          <strong>Total</strong>
        </dt>
        <dd>
          <strong>{formatRupees(quote.total_paise)}</strong>
        </dd>
        <dt>Advance</dt>
        <dd>{formatRupees(quote.advance_paise)}</dd>
        <dt>Balance</dt>
        <dd>{formatRupees(quote.balance_paise)}</dd>
      </dl>

      {quote.outcome === "approved" && quote.approved_at ? (
        <p className="hint">
          Approved by a person on <LocalTime iso={quote.approved_at} />. Nothing was sent.
        </p>
      ) : null}
      {quote.reject_code && quote.rejected_at ? (
        <p className="hint">
          Rejected on <LocalTime iso={quote.rejected_at} />: {REJECT_LABELS[quote.reject_code]}.
        </p>
      ) : null}
      {quote.withdraw_code && quote.withdrawn_at ? (
        <p className="hint">
          Withdrawn on <LocalTime iso={quote.withdrawn_at} />: {WITHDRAW_LABELS[quote.withdraw_code]}.
        </p>
      ) : null}

      <details>
        <summary className="tap">How these figures were made</summary>
        {manual ? (
          <p className="hint">
            A person typed the price of each line. The pricing engine (version {quote.engine_version}) worked out the GST and the totals from those prices and the quote policy
            that was in force, and the database checked every figure again. No language model calculated a price.
          </p>
        ) : (
          <p className="hint">
            The pricing engine (version {quote.engine_version}) worked them out from the price list and the quote policy that were in force, and the database
            checked every figure again. No person typed a price and no language model calculated one.
          </p>
        )}
        <dl className="summary">
          {quote.price_list_version_id !== null ? (
            <>
              <dt>Price list version</dt>
              <dd className="plain-text">{quote.price_list_version_id}</dd>
            </>
          ) : null}
          <dt>Policy version</dt>
          <dd className="plain-text">{quote.policy_version_id}</dd>
          <dt>Fingerprint</dt>
          <dd className="plain-text">{quote.canonical_hash.slice(0, 16)}</dd>
        </dl>
      </details>
    </div>
  );
}
