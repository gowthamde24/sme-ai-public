"use client";

import Link from "next/link";
import { useActionState } from "react";

import { HOW_IT_CAME, HOW_LABELS } from "@/lib/api/customers";

import type { CustomerFormState } from "./actions";

type Action = (prev: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;

/**
 * The form for one customer. The three ids come from the page (one set per render), so a second press is a retry. After a save it says what was made and what is still NOT done: no consent
 * is recorded, so a contact made here cannot yet be noted as contacted. It never shows the phone number or the e-mail back.
 */
export function CustomerForm({ action, tenantId, ids }: { action: Action; tenantId: string; ids: { company: string; contact: string; lead: string } }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  if (state?.ok && state.leadId && state.contactId)
    return (
      <div role="status" className="card" style={{ maxWidth: "40rem" }}>
        <p>
          <strong>Added {state.name}.</strong> A lead was made for this customer.
        </p>
        <p className="hint">No consent is recorded yet, so you cannot record that you contacted them. Record it next, once they have told you.</p>
        <p>
          <Link href={`/app/tenants/${tenantId}/contacts/${state.contactId}/consent`} className="tap">
            Record consent for this person →
          </Link>
        </p>
        <p>
          <Link href={`/app/tenants/${tenantId}/leads/${state.leadId}`} className="tap">
            Open the lead →
          </Link>
          {" · "}
          <Link href={`/app/tenants/${tenantId}/customers/new`} className="tap">
            Add another customer
          </Link>
        </p>
      </div>
    );
  return (
    <form action={formAction} className="card" style={{ maxWidth: "40rem" }} aria-label="Add a customer">
      <input type="hidden" name="company_id" value={ids.company} />
      <input type="hidden" name="contact_id" value={ids.contact} />
      <input type="hidden" name="lead_id" value={ids.lead} />
      <label htmlFor="cust-name">Customer&apos;s name</label>
      <input id="cust-name" name="full_name" required maxLength={200} disabled={pending} />
      <label htmlFor="cust-phone">WhatsApp or phone number</label>
      <input id="cust-phone" name="phone" required minLength={3} maxLength={32} inputMode="tel" autoComplete="off" disabled={pending} />
      <label htmlFor="cust-email">E-mail (optional)</label>
      <input id="cust-email" name="email" type="email" maxLength={254} autoComplete="off" disabled={pending} />
      <label htmlFor="cust-shop">Shop or business name (optional)</label>
      <input id="cust-shop" name="company_name" maxLength={200} disabled={pending} />
      <label htmlFor="cust-how">How did the enquiry come?</label>
      <select id="cust-how" name="how" defaultValue="phone_call" disabled={pending}>
        {HOW_IT_CAME.map((h) => (
          <option key={h} value={h}>
            {HOW_LABELS[h]}
          </option>
        ))}
      </select>
      <p className="hint">If you leave the shop name empty, the customer&apos;s name is used. Look in the Contacts list first: this form does not check whether you already added this person.</p>
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Add this customer"}
      </button>
    </form>
  );
}
