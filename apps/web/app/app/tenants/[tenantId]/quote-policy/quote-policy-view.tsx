import type { ReactNode } from "react";

import type { QuotePolicyVersion } from "@/lib/api/quote-policies";
import { formatBps, formatDate, formatRupees } from "@/lib/api/quotes";

import { LocalTime } from "../../../local-time";
import { detailsBox, kvList, listItemCard, listPlain, metaLine, noteBox, pageH1, summaryLine } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Say, type Words } from "@/components/v2/app/words";

/** Shipping in words: the shop charges no courier, so a version with no shipping says so; an older version that does carry a fee shows it as stored. */
function shippingText(v: QuotePolicyVersion): string {
  if (v.shipping_flat_fee_paise === 0 && v.shipping_tax_bps === 0 && v.shipping_free_above_paise === null) return "none (no courier charge)";
  const free = v.shipping_free_above_paise === null ? "" : `, free above ${formatRupees(v.shipping_free_above_paise)}`;
  return `flat fee ${formatRupees(v.shipping_flat_fee_paise)}, tax ${formatBps(v.shipping_tax_bps)}${free}`;
}

/** The sentence when no quote can be made because no version is in force. */
function noPolicyText(versions: QuotePolicyVersion[], t: Say): string {
  if (versions.length === 0) return t("qp.no_policy");
  const first = versions.map((v) => v.effective_from).sort()[0];
  return t("qp.no_policy_first", { date: formatDate(first) });
}

/** The published versions, newest first, in plain words. A version never changes: the owner or admin publishes a new one. The one in force is the API's own marker, not worked out here. */
export function QuotePolicyView({ versions, today, form, tabs = null, words }: { versions: QuotePolicyVersion[]; today: string; form: ReactNode; tabs?: ReactNode; words?: Words; }) {
  const t = makeT(words);
  const inForce = versions.some((v) => v.in_force);
  // The version in force (and any that has not started yet) first; the replaced ones behind "Earlier versions" so the page stays short. The newest is always shown.
  const live = versions.filter((v) => v.in_force || v.effective_from > today);
  const current = live.length > 0 ? live : versions.slice(0, 1);
  const earlier = versions.filter((v) => !current.includes(v));
  const version = (v: QuotePolicyVersion) => (
            <li key={v.id} className={listItemCard}>
              <strong>{t("qp.version_n", { n: v.version_no })}</strong> · {t("qp.starts_line", { date: formatDate(v.effective_from) })}
              {v.in_force ? " " + t("qp.in_force_today") : v.effective_from > today ? " " + t("qp.not_started_yet") : " " + t("qp.replaced_by_a_newer_version")}
              <dl className={kvList}>
                <dt>{t("qp.days_a_quote_is_valid")}</dt>
                <dd>{v.validity_days}</dd>
                <dt>{t("qp.advance_new_customer")}</dt>
                <dd>{formatBps(v.new_advance_bps)}</dd>
                <dt>{t("qp.advance_repeat_customer")}</dt>
                <dd>{formatBps(v.repeat_advance_bps)}</dd>
                <dt>{t("qp.days_to_pay_the_balance_new")}</dt>
                <dd>{v.new_net_days}</dd>
                <dt>{t("qp.days_to_pay_the_balance_repeat")}</dt>
                <dd>{v.repeat_net_days}</dd>
                <dt>{t("qp.gst_rate_prices_typed_by_hand")}</dt>
                <dd>{`${formatBps(v.gst_rate_bps)} from ${formatDate(v.gst_effective_from)}`}</dd>
                <dt>{t("qp.most_credit_for_one_repeat_customer_2")}</dt>
                <dd>{formatRupees(v.repeat_credit_limit_paise)}</dd>
                <dt>{t("qp.state_where_the_shop_is")}</dt>
                <dd>{v.seller_state}</dd>
                <dt>{t("qp.discount_ceiling")}</dt>
                <dd>{formatBps(v.discount_ceiling_bps)}</dd>
                <dt>{t("qp.shipping")}</dt>
                <dd>{shippingText(v)}</dd>
              </dl>
              <span className={metaLine}>
                <Rich t={t} k="qp.published_line" with={{ time: <LocalTime iso={v.created_at} /> }} />
              </span>
            </li>
  );

  return (
    <section aria-labelledby="quote-policy-heading">
      <h1 id="quote-policy-heading" className={pageH1}>
        {t("qp.the_quote_policy")}
      </h1>

      {tabs}      {!inForce && (
        <p role="note" className={noteBox}>
          {noPolicyText(versions, t)}
        </p>
      )}
      {versions.length > 0 && (
        <ul aria-label={t("qp.quote_policy_versions_newest_first")} className={listPlain}>
          {current.map(version)}
        </ul>
      )}
      {earlier.length > 0 && (
        <details className={detailsBox}>
          <summary className={summaryLine}>{t("qp.earlier_n", { n: earlier.length })}</summary>
          <ul aria-label={t("qp.earlier_quote_policy_versions")} className={listPlain}>
            {earlier.map(version)}
          </ul>
        </details>
      )}
      {form}
    </section>
  );
}
