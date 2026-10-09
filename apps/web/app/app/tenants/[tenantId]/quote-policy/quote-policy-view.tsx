import type { ReactNode } from "react";

import type { QuotePolicyVersion } from "@/lib/api/quote-policies";
import { formatBps, formatDate, formatRupees } from "@/lib/api/quotes";

import { LocalTime } from "../../../local-time";
import { kvList, listItemCard, listPlain, metaLine, noteBox, pageH1 } from "@/components/v2/app/ui";

/** Shipping in words: the shop charges no courier, so a version with no shipping says so; an older version that does carry a fee shows it as stored. */
function shippingText(v: QuotePolicyVersion): string {
  if (v.shipping_flat_fee_paise === 0 && v.shipping_tax_bps === 0 && v.shipping_free_above_paise === null) return "none (no courier charge)";
  const free = v.shipping_free_above_paise === null ? "" : `, free above ${formatRupees(v.shipping_free_above_paise)}`;
  return `flat fee ${formatRupees(v.shipping_flat_fee_paise)}, tax ${formatBps(v.shipping_tax_bps)}${free}`;
}

/** The sentence when no quote can be made because no version is in force. */
function noPolicyText(versions: QuotePolicyVersion[]): string {
  const base = "No quote policy is in force. Until an owner or an admin publishes one, a quote cannot be made (a manual quote would be refused).";
  if (versions.length === 0) return base;
  const first = versions.map((v) => v.effective_from).sort()[0];
  return `${base} The first published version starts on ${formatDate(first)}.`;
}

/** The published versions, newest first, in plain words. A version never changes: the owner or admin publishes a new one. The one in force is the API's own marker, not worked out here. */
export function QuotePolicyView({ versions, today, form }: { versions: QuotePolicyVersion[]; today: string; form: ReactNode }) {
  const inForce = versions.some((v) => v.in_force);
  return (
    <section aria-labelledby="quote-policy-heading">
      <h1 id="quote-policy-heading" className={pageH1}>
        The quote policy
      </h1>
      {!inForce && (
        <p role="note" className={noteBox}>
          {noPolicyText(versions)}
        </p>
      )}
      {versions.length > 0 && (
        <ul aria-label="Quote policy versions, newest first" className={listPlain}>
          {versions.map((v) => (
            <li key={v.id} className={listItemCard}>
              <strong>Version {v.version_no}</strong> · starts {formatDate(v.effective_from)}
              {v.in_force ? " · in force today" : v.effective_from > today ? " · not started yet" : " · replaced by a newer version"}
              <dl className={kvList}>
                <dt>Days a quote is valid</dt>
                <dd>{v.validity_days}</dd>
                <dt>Advance, new customer</dt>
                <dd>{formatBps(v.new_advance_bps)}</dd>
                <dt>Advance, repeat customer</dt>
                <dd>{formatBps(v.repeat_advance_bps)}</dd>
                <dt>Days to pay the balance, new customer</dt>
                <dd>{v.new_net_days}</dd>
                <dt>Days to pay the balance, repeat customer</dt>
                <dd>{v.repeat_net_days}</dd>
                <dt>GST rate, prices typed by hand</dt>
                <dd>{`${formatBps(v.gst_rate_bps)} from ${formatDate(v.gst_effective_from)}`}</dd>
                <dt>Most credit for one repeat customer</dt>
                <dd>{formatRupees(v.repeat_credit_limit_paise)}</dd>
                <dt>State where the shop is</dt>
                <dd>{v.seller_state}</dd>
                <dt>Discount ceiling</dt>
                <dd>{formatBps(v.discount_ceiling_bps)}</dd>
                <dt>Shipping</dt>
                <dd>{shippingText(v)}</dd>
              </dl>
              <span className={metaLine}>
                Published <LocalTime iso={v.created_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {form}
    </section>
  );
}
