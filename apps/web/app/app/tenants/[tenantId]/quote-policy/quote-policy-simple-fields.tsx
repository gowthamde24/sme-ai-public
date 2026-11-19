"use client";

import type { ChangeEvent } from "react";

import { Sentence, EffectBox, MoreChoices } from "@/components/v2/app/jobs/rules/parts";
import { JbCard, PillField } from "@/components/v2/app/settings/simple-b";
import { jbHelp } from "@/components/v2/app/settings/simple-b-styles";
import type { Say } from "@/components/v2/app/words";
import { formatDate } from "@/lib/api/quotes";

import { calendarDate, percentToBps, wholeNumber, type FieldName, type PolicyValues } from "./quote-policy-logic";

/** "2026-12-01" and 7 days later as "8 Dec 2026" (calendar days in India: no clock, no zone). */
function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + n));
  return formatDate(`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`);
}

/** The "What it will do:" line of the quote rules, worked out from what is typed right now. The same readers as the form's own checks: a field that does not read as a number yet leaves the line asking for it. */
export function quoteEffect(t: Say, v: PolicyValues, minDate: string): string {
  const start = calendarDate(v.effective_from) ?? minDate;
  const days = wholeNumber(v.validity_days, 1, 365);
  const adv = percentToBps(v.new_advance);
  const net = wholeNumber(v.new_net_days, 0, 180);
  if (days === null || adv === null || net === null) return t("jobs.set.b.q.fx.empty");
  return t("jobs.set.b.q.fx", { start: formatDate(start), until: plusDays(start, days), adv: adv / 100, net });
}

/**
 * The fields of "Publish a new version" under JOBS: the quote rules as sentences with the number typed inside them, four choices in the first card, two in the second, the tax and limits under "More choices". Every field starts EMPTY (no default of ours) and keeps its
 * name, so the form sends the same FormData as before; the same checks run first (policyFromForm), the same refusals are shown. The lines that explain a rule keep their words.
 */
export function QuotePolicySimpleFields({ t, values, change, pending, minDate }: { t: Say; values: PolicyValues; change: (name: FieldName) => (e: ChangeEvent<HTMLInputElement>) => void; pending: boolean; minDate: string }) {
  const num = (name: FieldName, aria: string, width = "w-24", mode: "numeric" | "decimal" = "numeric") => <PillField aria={aria} id={`qp-${name}`} name={name} inputMode={mode} autoComplete="off" required value={values[name]} onChange={change(name)} disabled={pending} width={width} placeholder="–" />;
  return (
    <>
      <p className={jbHelp}>{t("qp.a_published_version_never_changes_a")}</p>
      <JbCard id="qp-main-h" title={t("jobs.set.b.q.main")} part="quote-simple-main">
        <Sentence line="starts" template={t("jobs.set.b.q.starts.line")} parts={{ date: (aria) => <PillField aria={aria} id="qp-from" name="effective_from" type="date" min={minDate} required value={values.effective_from} onChange={change("effective_from")} disabled={pending} width="w-44" /> }} />
        <Sentence line="valid" template={t("jobs.set.b.q.valid.line")} parts={{ n: (aria) => num("validity_days", aria) }} />
        <Sentence
          line="advance"
          template={t("jobs.set.b.q.advance.line")}
          parts={{ n: (aria) => num("new_advance", `${aria} (1)`, "w-24", "decimal"), m: (aria) => num("repeat_advance", `${aria} (2)`, "w-24", "decimal") }}
        />
        <EffectBox label={t("jobs.set.b.effect")} text={quoteEffect(t, values, minDate)} />
      </JbCard>

      <JbCard id="qp-balance-h" title={t("qp.days_to_pay_the_balance")} part="quote-simple-balance">
        <Sentence line="balance" template={t("jobs.set.b.q.balance.line")} parts={{ n: (aria) => num("new_net_days", `${aria} (1)`), m: (aria) => num("repeat_net_days", `${aria} (2)`) }} />
        <p className={jbHelp}>{t("qp.the_balance_on_a_quote_is")}</p>
      </JbCard>

      <MoreChoices title={t("jobs.set.b.more")} sub={t("jobs.set.b.q.more_sub")}>
        <Sentence line="gst" template={t("jobs.set.b.q.gst.line")} parts={{ n: (aria) => num("gst_rate", aria, "w-24", "decimal") }} />
        <p className={jbHelp}>{t("qp.added_on_top_of_every_price")}</p>
        <Sentence line="credit" template={t("jobs.set.b.q.credit.line")} parts={{ n: (aria) => num("credit_limit", aria, "w-32", "decimal") }} />
        <p className={jbHelp}>{t("qp.a_quote_for_a_repeat_customer")}</p>
        <Sentence line="state" template={t("jobs.set.b.q.state.line")} parts={{ n: (aria) => <PillField aria={aria} id="qp-seller_state" name="seller_state" autoComplete="off" required value={values.seller_state} onChange={change("seller_state")} disabled={pending} width="w-20" placeholder="–" maxLength={2} /> }} />
        <p className={jbHelp}>{t("qp.the_state_code_on_your_gst")}</p>
        <Sentence line="discount" template={t("jobs.set.b.q.discount.line")} parts={{ n: (aria) => num("discount_ceiling", aria, "w-24", "decimal") }} />
        <p className={jbHelp}>{t("qp.the_most_discount_in_percent_that")}</p>
        <p className="m-0 text-[15px] text-ink">{t("qp.shipping_none_no_courier_charge")}</p>
        <p className={jbHelp}>{t("qp.this_page_does_not_have_a")}</p>
      </MoreChoices>
    </>
  );
}
