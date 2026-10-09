"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type ChangeEvent } from "react";

import type { QuotePolicyState } from "./quote-policy-actions";
import { EMPTY_VALUES, policyFromForm, type FieldName, type PolicyValues } from "./quote-policy-logic";
import { alertBox, bodyText, btnMain, fieldHelp, fieldInput, fieldLabel, fieldsetPlain, formCard, formTitle, legendText, link, mutedText, okBox } from "@/components/v2/app/ui";

type Action = (prev: QuotePolicyState, formData: FormData) => Promise<QuotePolicyState>;
type Props = { action: Action; policyId: string; today: string; minDate: string };

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

function QuotePolicyBody({ action, policyId, today, minDate, onSaved, onPress }: Props & { onSaved: (message: string) => void; onPress: () => void }) {
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
        Publish a new version
      </h3>
      <p className={mutedText}>A published version never changes. A new version replaces the one in force from its start date. Every field starts empty on purpose: type the shop&apos;s own numbers.</p>
      <p className={mutedText}>This page does not have a price range for each item type or a last-price warning yet.</p>
      <input type="hidden" name="policy_id" value={id} />

      <label htmlFor="qp-from" className={fieldLabel}>
        Starts on
      </label>
      <input id="qp-from" className={fieldInput} name="effective_from" type="date" min={minDate} required value={values.effective_from} onChange={change("effective_from")} disabled={pending} />

      <label htmlFor="qp-valid" className={fieldLabel}>
        Days a quote is valid
      </label>
      <input id="qp-valid" className={fieldInput} name="validity_days" inputMode="numeric" autoComplete="off" required value={values.validity_days} onChange={change("validity_days")} disabled={pending} />

      <label htmlFor="qp-new" className={fieldLabel}>
        Advance for a new customer (percent)
      </label>
      <input id="qp-new" className={fieldInput} name="new_advance" inputMode="decimal" autoComplete="off" required value={values.new_advance} onChange={change("new_advance")} disabled={pending} />

      <label htmlFor="qp-repeat" className={fieldLabel}>
        Advance for a repeat customer (percent)
      </label>
      <input id="qp-repeat" className={fieldInput} name="repeat_advance" inputMode="decimal" autoComplete="off" required value={values.repeat_advance} onChange={change("repeat_advance")} disabled={pending} />

      <fieldset aria-describedby="qp-net-hint" className={fieldsetPlain}>
        <legend className={legendText}>Days to pay the balance</legend>
        <p id="qp-net-hint" className={fieldHelp}>
          The balance on a quote is due this many days after the quote date, by the kind of customer.
        </p>
        <label htmlFor="qp-net-new" className={fieldLabel}>
        New customers (days)
      </label>
        <input id="qp-net-new" className={fieldInput} name="new_net_days" inputMode="numeric" autoComplete="off" required value={values.new_net_days} onChange={change("new_net_days")} disabled={pending} />

        <label htmlFor="qp-net-repeat" className={fieldLabel}>
        Repeat customers (days)
      </label>
        <input id="qp-net-repeat" className={fieldInput} name="repeat_net_days" inputMode="numeric" autoComplete="off" required value={values.repeat_net_days} onChange={change("repeat_net_days")} disabled={pending} />
      </fieldset>

      <label htmlFor="qp-gst" className={fieldLabel}>
        GST rate (percent)
      </label>
      <input id="qp-gst" className={fieldInput} name="gst_rate" inputMode="decimal" autoComplete="off" required aria-describedby="qp-gst-hint" value={values.gst_rate} onChange={change("gst_rate")} disabled={pending} />
      <p id="qp-gst-hint" className={fieldHelp}>
        Added on top of every price typed by hand, from the start date above. A price list keeps the rate of each of its items.
      </p>

      <label htmlFor="qp-credit" className={fieldLabel}>
        Most credit for one repeat customer (rupees)
      </label>
      <input id="qp-credit" className={fieldInput} name="credit_limit" inputMode="decimal" autoComplete="off" required aria-describedby="qp-credit-hint" value={values.credit_limit} onChange={change("credit_limit")} disabled={pending} />
      <p id="qp-credit-hint" className={fieldHelp}>
        A quote for a repeat customer whose balance is above this is marked as needing the Owner&apos;s approval.
      </p>

      <label htmlFor="qp-state" className={fieldLabel}>
        State where the shop is (two capital letters)
      </label>
      <input id="qp-state" className={fieldInput} name="seller_state" autoComplete="off" required aria-describedby="qp-state-hint" value={values.seller_state} onChange={change("seller_state")} disabled={pending} />
      <p id="qp-state-hint" className={fieldHelp}>
        The state code on your GST papers. It decides whether a sale is in your state or in another state.
      </p>

      <label htmlFor="qp-discount" className={fieldLabel}>
        Discount ceiling (percent)
      </label>
      <input id="qp-discount" className={fieldInput} name="discount_ceiling" inputMode="decimal" autoComplete="off" required aria-describedby="qp-discount-hint" value={values.discount_ceiling} onChange={change("discount_ceiling")} disabled={pending} />
      <p id="qp-discount-hint" className={fieldHelp}>
        The most discount, in percent, that a quote line may carry; today no quote line carries a discount, so this number is saved with the policy but changes no quote.
      </p>

      <p className={bodyText}>Shipping: none (no courier charge)</p>

      {error && (
        <div role="alert" className={alertBox}>
          <p>{error}</p>
          {showMfa && (
            <p>
              <Link href="/app/security" className={link}>
                Open the Security page →
              </Link>
            </p>
          )}
        </div>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? "Publishing..." : "Publish this version"}
      </button>
    </form>
  );
}
