"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type ChangeEvent } from "react";

import { makeT, type Words } from "@/components/v2/app/words";
import type { QuotePolicyState } from "./quote-policy-actions";
import { EMPTY_VALUES, policyFromForm, type FieldName, type PolicyValues } from "./quote-policy-logic";
import { alertBox, bodyText, btnMain, fieldHelp, fieldInput, fieldLabel, fieldsetPlain, formCard, formTitle, legendText, link, mutedText, okBox } from "@/components/v2/app/ui";

type Action = (prev: QuotePolicyState, formData: FormData) => Promise<QuotePolicyState>;
type Props = { action: Action; policyId: string; today: string; minDate: string; words?: Words };

/**
 * Publish a new quote policy version. EVERY field starts empty: nothing is selected and there is no default of ours. The shipping is not an input: it is fixed at zero (the shop charges no courier)
 * and shown as one read-only line. The days to pay the balance are two fields, one for new and one for repeat customers. The GST rate is one more required field with no default.
 *
 * The id comes from the page (one per render), so a second press is a retry. The body is keyed on that id: a new id from the page restarts the form (empty fields, the new id). After a SAVED version
 * the form gets a fresh id and empties its fields (the next version is a new record, not a replay) and the success sentence, which lives OUTSIDE the keyed body so the page's re-render cannot hide it,
 * stays until the next press. Held in state and submitted through onSubmit, so a refusal keeps what the person typed. The same checks as the server action run first, so a wrong or missing value gets
 * its sentence of ours without a request (the browser's own bubbles are off: one place for the wording).
 */
export function QuotePolicyForm(props: Props) {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <QuotePolicyBody key={props.policyId} {...props} onSaved={setSaved} onPress={() => setSaved(null)} />
      {saved && (
        <p role="status" className={okBox}>
          {saved}
        </p>
      )}
    </>
  );
}

function QuotePolicyBody({ action, policyId, today, minDate, onSaved, onPress, words }: Props & { onSaved: (message: string) => void; onPress: () => void }) {
  const t = makeT(words);
  const [id, setId] = useState(policyId);
  const [values, setValues] = useState<PolicyValues>(EMPTY_VALUES);
  const [localError, setLocalError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async (prev: QuotePolicyState, formData: FormData) => {
    const next = await action(prev, formData);
    if (next?.ok) {
      setId(crypto.randomUUID());
      setValues(EMPTY_VALUES);
      if (next.message) onSaved(next.message);
    }
    return next;
  }, undefined);
  const change = (name: FieldName) => (event: ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: event.target.value }));
  const error = localError ?? state?.error ?? null;
  const showMfa = localError === null && state?.reason === "mfa";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onPress();
        const checked = policyFromForm(values, id, today);
        if (!checked.ok) {
          setLocalError(checked.error);
          return;
        }
        setLocalError(null);
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      noValidate
      className={formCard}
      aria-labelledby="quote-policy-title"
    >
      <h3 id="quote-policy-title" className={formTitle}>
        {t("qp.publish_a_new_version")}
      </h3>
      <p className={mutedText}>{t("qp.a_published_version_never_changes_a")}</p>
      <p className={mutedText}>{t("qp.this_page_does_not_have_a")}</p>
      <input type="hidden" name="policy_id" value={id} />

      <label htmlFor="qp-from" className={fieldLabel}>
        {t("qp.starts_on")}
      </label>
      <input id="qp-from" className={fieldInput} name="effective_from" type="date" min={minDate} required value={values.effective_from} onChange={change("effective_from")} disabled={pending} />

      <label htmlFor="qp-valid" className={fieldLabel}>
        {t("qp.days_a_quote_is_valid")}
      </label>
      <input id="qp-valid" className={fieldInput} name="validity_days" inputMode="numeric" autoComplete="off" required value={values.validity_days} onChange={change("validity_days")} disabled={pending} />

      <label htmlFor="qp-new" className={fieldLabel}>
        {t("qp.advance_for_a_new_customer_percent")}
      </label>
      <input id="qp-new" className={fieldInput} name="new_advance" inputMode="decimal" autoComplete="off" required value={values.new_advance} onChange={change("new_advance")} disabled={pending} />

      <label htmlFor="qp-repeat" className={fieldLabel}>
        {t("qp.advance_for_a_repeat_customer_percent")}
      </label>
      <input id="qp-repeat" className={fieldInput} name="repeat_advance" inputMode="decimal" autoComplete="off" required value={values.repeat_advance} onChange={change("repeat_advance")} disabled={pending} />

      <fieldset aria-describedby="qp-net-hint" className={fieldsetPlain}>
        <legend className={legendText}>{t("qp.days_to_pay_the_balance")}</legend>
        <p id="qp-net-hint" className={fieldHelp}>
          {t("qp.the_balance_on_a_quote_is")}
        </p>
        <label htmlFor="qp-net-new" className={fieldLabel}>
        {t("qp.new_customers_days")}
      </label>
        <input id="qp-net-new" className={fieldInput} name="new_net_days" inputMode="numeric" autoComplete="off" required value={values.new_net_days} onChange={change("new_net_days")} disabled={pending} />

        <label htmlFor="qp-net-repeat" className={fieldLabel}>
        {t("qp.repeat_customers_days")}
      </label>
        <input id="qp-net-repeat" className={fieldInput} name="repeat_net_days" inputMode="numeric" autoComplete="off" required value={values.repeat_net_days} onChange={change("repeat_net_days")} disabled={pending} />
      </fieldset>

      <label htmlFor="qp-gst" className={fieldLabel}>
        {t("qp.gst_rate_percent")}
      </label>
      <input id="qp-gst" className={fieldInput} name="gst_rate" inputMode="decimal" autoComplete="off" required aria-describedby="qp-gst-hint" value={values.gst_rate} onChange={change("gst_rate")} disabled={pending} />
      <p id="qp-gst-hint" className={fieldHelp}>
        {t("qp.added_on_top_of_every_price")}
      </p>

      <label htmlFor="qp-credit" className={fieldLabel}>
        {t("qp.most_credit_for_one_repeat_customer")}
      </label>
      <input id="qp-credit" className={fieldInput} name="credit_limit" inputMode="decimal" autoComplete="off" required aria-describedby="qp-credit-hint" value={values.credit_limit} onChange={change("credit_limit")} disabled={pending} />
      <p id="qp-credit-hint" className={fieldHelp}>
        {t("qp.a_quote_for_a_repeat_customer")}
      </p>

      <label htmlFor="qp-state" className={fieldLabel}>
        {t("qp.state_where_the_shop_is_two")}
      </label>
      <input id="qp-state" className={fieldInput} name="seller_state" autoComplete="off" required aria-describedby="qp-state-hint" value={values.seller_state} onChange={change("seller_state")} disabled={pending} />
      <p id="qp-state-hint" className={fieldHelp}>
        {t("qp.the_state_code_on_your_gst")}
      </p>

      <label htmlFor="qp-discount" className={fieldLabel}>
        {t("qp.discount_ceiling_percent")}
      </label>
      <input id="qp-discount" className={fieldInput} name="discount_ceiling" inputMode="decimal" autoComplete="off" required aria-describedby="qp-discount-hint" value={values.discount_ceiling} onChange={change("discount_ceiling")} disabled={pending} />
      <p id="qp-discount-hint" className={fieldHelp}>
        {t("qp.the_most_discount_in_percent_that")}
      </p>

      <p className={bodyText}>{t("qp.shipping_none_no_courier_charge")}</p>

      {error && (
        <div role="alert" className={alertBox}>
          <p>{error}</p>
          {showMfa && (
            <p>
              <Link href="/app/security" className={link}>
                {t("qp.open_the_security_page")}
              </Link>
            </p>
          )}
        </div>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("qp.publishing") : t("qp.publish_this_version")}
      </button>
    </form>
  );
}
