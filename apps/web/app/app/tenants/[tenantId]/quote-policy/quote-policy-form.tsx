"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type ChangeEvent } from "react";

import type { QuotePolicyState } from "./quote-policy-actions";
import { EMPTY_VALUES, policyFromForm, type FieldName, type PolicyValues } from "./quote-policy-logic";

type Action = (prev: QuotePolicyState, formData: FormData) => Promise<QuotePolicyState>;
type Props = { action: Action; policyId: string; today: string; minDate: string };

/**
 * Publish a new quote policy version. EVERY field starts empty: nothing is selected and there is no default of ours. The shipping is not an input: it is fixed at zero (the shop charges no courier)
 * and shown as one read-only line. There is no GST rate, price range or last-price field: those need a later database change.
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
        <p role="status" className="hint">
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
      className="card"
      style={{ maxWidth: "36rem" }}
      aria-labelledby="quote-policy-title"
    >
      <h3 id="quote-policy-title" style={{ margin: 0 }}>
        Publish a new version
      </h3>
      <p className="hint">A published version never changes. A new version replaces the one in force from its start date. Every field starts empty on purpose: type the shop&apos;s own numbers.</p>
      <p className="hint">This page does not have a GST rate, a price range for each saree type or a last-price warning yet, because they need a later database change.</p>
      <input type="hidden" name="policy_id" value={id} />

      <label htmlFor="qp-from">Starts on</label>
      <input id="qp-from" name="effective_from" type="date" min={minDate} required value={values.effective_from} onChange={change("effective_from")} disabled={pending} />

      <label htmlFor="qp-valid">Days a quote is valid</label>
      <input id="qp-valid" name="validity_days" inputMode="numeric" autoComplete="off" required value={values.validity_days} onChange={change("validity_days")} disabled={pending} />

      <label htmlFor="qp-new">Advance for a new customer (percent)</label>
      <input id="qp-new" name="new_advance" inputMode="decimal" autoComplete="off" required value={values.new_advance} onChange={change("new_advance")} disabled={pending} />

      <label htmlFor="qp-repeat">Advance for a repeat customer (percent)</label>
      <input id="qp-repeat" name="repeat_advance" inputMode="decimal" autoComplete="off" required value={values.repeat_advance} onChange={change("repeat_advance")} disabled={pending} />

      <label htmlFor="qp-net">Days of credit (the balance on a quote is due this many days after the quote date)</label>
      <input id="qp-net" name="net_days" inputMode="numeric" autoComplete="off" required value={values.net_days} onChange={change("net_days")} disabled={pending} />

      <label htmlFor="qp-credit">Most credit for one repeat customer (rupees)</label>
      <input id="qp-credit" name="credit_limit" inputMode="decimal" autoComplete="off" required aria-describedby="qp-credit-hint" value={values.credit_limit} onChange={change("credit_limit")} disabled={pending} />
      <p id="qp-credit-hint" className="hint">
        A quote for a repeat customer whose balance is above this is marked as needing the Owner&apos;s approval.
      </p>

      <label htmlFor="qp-state">State where the shop is (two capital letters)</label>
      <input id="qp-state" name="seller_state" autoComplete="off" required aria-describedby="qp-state-hint" value={values.seller_state} onChange={change("seller_state")} disabled={pending} />
      <p id="qp-state-hint" className="hint">
        The state code on your GST papers. It decides whether a sale is in your state or in another state.
      </p>

      <label htmlFor="qp-discount">Discount ceiling (percent)</label>
      <input id="qp-discount" name="discount_ceiling" inputMode="decimal" autoComplete="off" required aria-describedby="qp-discount-hint" value={values.discount_ceiling} onChange={change("discount_ceiling")} disabled={pending} />
      <p id="qp-discount-hint" className="hint">
        The most discount, in percent, that a quote line may carry; today no quote line carries a discount, so this number is saved with the policy but changes no quote.
      </p>

      <p>Shipping: none (no courier charge)</p>

      {error && (
        <div role="alert" className="error hint">
          <p>{error}</p>
          {showMfa && (
            <p>
              <Link href="/app/security" className="tap">
                Open the Security page →
              </Link>
            </p>
          )}
        </div>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Publishing..." : "Publish this version"}
      </button>
    </form>
  );
}
