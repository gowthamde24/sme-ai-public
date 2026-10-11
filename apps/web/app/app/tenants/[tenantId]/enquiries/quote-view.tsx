import { formatBps, formatDate, formatRupees, isManual, type Quote } from "@/lib/api/quotes";

import { LocalTime } from "../../../local-time";
import { Pill } from "@/components/v2/app/parts";
import { bulletList, detailsBox, dlCompact, hintInline, kvList, listItemCard, listPlain, mutedText, noteBox, pageH3, pageH4, plainText, rowWrap, summaryLine } from "@/components/v2/app/ui";
import { labelOr, makeT, type Words } from "@/components/v2/app/words";

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "plain" | "warn" }) {
  return <Pill tone={tone === "good" ? "green" : tone === "warn" ? "amber" : "neutral"}>{children}</Pill>;
}

const unitWord = (qty: number, unit: string) => `${qty} ${unit}${qty === 1 ? "" : "s"}`;

/**
 * One quote, every figure and every flag. The figures are the pricing engine's, verified again by the database: nothing on this screen was typed by a
 * person or worked out by a language model. Names and requirement text are plain text. A quote is a Draft until a person approves it; no quote here is ever
 * "Sent", because this application sends nothing. A quote whose prices a person typed (`pricing_kind` "manual") shows the item type's name and says the price was typed by a
 * person; it has no price list, and may have no delivery state, and those rows are left out. The internal line key (LINE-n) is never shown. A list-price quote renders exactly as before.
 */
export function QuoteView({ quote, stateName, words }: { quote: Quote; stateName: string; words?: Words; }) {
  const t = makeT(words);
  const flags = [...quote.engine_flags, ...quote.review_flags];
  const manual = isManual(quote);
  // a quote with typed prices has no freight line: its two freight rows are left out, unless the quote somehow carries freight money (then it is shown, never hidden)
  const showFreight = !manual || quote.shipping_net_paise !== 0 || quote.shipping_tax_paise !== 0;
  return (
    <div>
      <div className={rowWrap}>
        <h3 className={pageH3}>{t("enq.quote_n", { n: quote.quote_no })}</h3>
        <Badge tone={quote.outcome === "approved" ? "good" : quote.outcome === "draft" ? "warn" : "plain"}>{t(`enq.outcome.${quote.outcome}`)}</Badge>
        {manual ? <Badge tone="plain">{t("enq.typed_prices")}</Badge> : null}
        {quote.needs_owner_approval ? <Badge tone="warn">{t("enq.needs_the_owner_s_approval")}</Badge> : null}
      </div>

      {flags.length > 0 ? (
        <div role="note" className={noteBox}>
          <strong>{t("enq.please_read_before_approving")}</strong>
          <ul className={bulletList}>
            {flags.map((flag) => (
              <li key={flag}>{labelOr(t, `enq.qflag.${flag}`, "enq.this_quote_carries_a_flag_the")}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className={kvList}>
        <dt>{t("enq.customer")}</dt>
        <dd>{t(`enq.kind.${quote.customer_kind}`)}</dd>
        {quote.delivery_state !== null ? (
          <>
            <dt>{t("enq.delivery")}</dt>
            <dd>
              <span className={plainText}>{stateName}</span> ({quote.delivery_state}), {quote.gst_supply === "intra_state" ? t("enq.the_seller_s_own_state") : t("enq.another_state")}
            </dd>
          </>
        ) : null}
        <dt>{t("enq.made_on")}</dt>
        <dd>{formatDate(quote.as_of)}</dd>
        <dt>{t("enq.valid_until")}</dt>
        <dd>{formatDate(quote.valid_until)}</dd>
        <dt>{t("enq.balance_due_by")}</dt>
        <dd>{formatDate(quote.due_date)}</dd>
      </dl>

      <h4 className={pageH4}>{t("enq.lines")}</h4>
      <ul className={listPlain}>
        {quote.lines.map((line) => (
          <li key={line.line_no} className={listItemCard}>
            <strong className={plainText}>{line.name}</strong>{" "}
            {manual ? <span className={hintInline}>{t("enq.price_typed_by_a_person")}</span> : <span className={hintInline}>{t("enq.sku_req_line", { sku: line.sku, n: line.requirement_line_no })}</span>}
            <dl className={dlCompact}>
              <dt>{t("enq.quantity")}</dt>
              <dd>{unitWord(line.qty, line.sale_unit)}</dd>
              <dt>{t("enq.price")}</dt>
              <dd>
                {t("enq.price_each", { price: formatRupees(line.unit_price_applied_paise) })}
                {line.price_break_min_qty !== null ? ` ${t("enq.price_break", { n: line.price_break_min_qty })}` : ""}
              </dd>
              <dt>{t("enq.amount")}</dt>
              <dd>{formatRupees(line.net_paise)}</dd>
              <dt>{t("enq.gst_bps", { rate: formatBps(line.tax_bps) })}</dt>
              <dd>{formatRupees(line.tax_paise)}</dd>
              <dt>{t("enq.line_total")}</dt>
              <dd>{formatRupees(line.gross_paise)}</dd>
            </dl>
          </li>
        ))}
      </ul>

      {quote.unquoted_lines.length > 0 ? (
        <div role="note" className={noteBox}>
          <strong>{t("enq.not_in_this_quote")}</strong> {t("enq.not_in_quote_because")}
          <ul className={bulletList}>
            {quote.unquoted_lines.map((line) => (
              <li key={line.line_no} className={plainText}>
                {t("enq.line_n", { n: line.line_no })}: {line.summary.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h4 className={pageH4}>{t("enq.totals")}</h4>
      <dl className={kvList}>
        <dt>{t("enq.goods")}</dt>
        <dd>{formatRupees(quote.merchandise_net_paise)}</dd>
        <dt>{t("enq.gst_on_goods")}</dt>
        <dd>{formatRupees(quote.item_tax_paise)}</dd>
        {showFreight ? (
          <>
            <dt>{t("enq.freight")}</dt>
            <dd>{formatRupees(quote.shipping_net_paise)}</dd>
            <dt>{t("enq.gst_on_freight")}</dt>
            <dd>{formatRupees(quote.shipping_tax_paise)}</dd>
          </>
        ) : null}
        <dt>
          <strong>{t("enq.total")}</strong>
        </dt>
        <dd>
          <strong>{formatRupees(quote.total_paise)}</strong>
        </dd>
        <dt>{t("enq.advance")}</dt>
        <dd>{formatRupees(quote.advance_paise)}</dd>
        <dt>{t("enq.balance")}</dt>
        <dd>{formatRupees(quote.balance_paise)}</dd>
      </dl>

      {quote.outcome === "approved" && quote.approved_at ? (
        <p className={mutedText}>
          {t("enq.approved_on")} <LocalTime iso={quote.approved_at} />{t("enq.nothing_was_sent_dot")}
        </p>
      ) : null}
      {quote.reject_code && quote.rejected_at ? (
        <p className={mutedText}>
          {t("enq.rejected_on")} <LocalTime iso={quote.rejected_at} />: {t(`enq.reject.${quote.reject_code}`)}.
        </p>
      ) : null}
      {quote.withdraw_code && quote.withdrawn_at ? (
        <p className={mutedText}>
          {t("enq.withdrawn_on")} <LocalTime iso={quote.withdrawn_at} />: {t(`enq.withdraw.${quote.withdraw_code}`)}.
        </p>
      ) : null}

      <details className={detailsBox}>
        <summary className={summaryLine}>{t("enq.how_these_figures_were_made")}</summary>
        {manual ? (
          <p className={mutedText}>
            {t("enq.engine_manual", { version: quote.engine_version })}
          </p>
        ) : (
          <p className={mutedText}>
            {t("enq.engine_list", { version: quote.engine_version })}
          </p>
        )}
        <dl className={kvList}>
          {quote.price_list_version_id !== null ? (
            <>
              <dt>{t("enq.price_list_version")}</dt>
              <dd className={plainText}>{quote.price_list_version_id}</dd>
            </>
          ) : null}
          <dt>{t("enq.policy_version")}</dt>
          <dd className={plainText}>{quote.policy_version_id}</dd>
          <dt>{t("enq.fingerprint")}</dt>
          <dd className={plainText}>{quote.canonical_hash.slice(0, 16)}</dd>
        </dl>
      </details>
    </div>
  );
}
