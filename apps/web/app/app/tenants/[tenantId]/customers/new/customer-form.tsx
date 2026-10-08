"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { HOW_IT_CAME, HOW_LABELS } from "@/lib/api/customers";

import type { CustomerFormState } from "./actions";

type Action = (prev: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;

/**
 * The form for one customer. The three ids come from the page (one set per render), so a second press is a retry. After a save it says what was made and what is still NOT done: no consent
 * is recorded, so a contact made here cannot yet be noted as contacted. It never shows the phone number or the e-mail back after a SAVE.
 *
 * What the person typed is held in state and the form is submitted through onSubmit, not an `action` prop (React resets the fields of an `action` form when it finishes): after a refusal
 * every field still shows what was typed, so only the wrong value needs fixing. After a duplicate e-mail the server hands back a FRESH contact id (the contact was not made); the company and
 * lead ids stay, so the company replays and no second company is made.
 */
type Ids = { company: string; contact: string; lead: string };

/**
 * One customer per set of ids. Everything the form holds (the typed values, the contact id after a duplicate e-mail, the result of the last press) belongs to ONE set of ids, so the body below is
 * remounted whenever the ids change: new ids from a new page render, or the person pressing "Add another customer", which makes fresh ids here and restarts in place. Without this a second
 * customer could be sent with the first customer's contact id and typed values (the page's own `key` is not enough: a component must not rely on its caller for it).
 */
export function CustomerForm({ action, tenantId, ids: pageIds }: { action: Action; tenantId: string; ids: Ids }) {
  const pageKey = `${pageIds.company}|${pageIds.contact}|${pageIds.lead}`;
  const [seenKey, setSeenKey] = useState(pageKey);
  const [ids, setIds] = useState(pageIds);
  const [round, setRound] = useState(0);
  if (seenKey !== pageKey) {
    // the page rendered new ids: start clean (adjusting state while rendering is React's documented way to reset state when a prop changes)
    setSeenKey(pageKey);
    setIds(pageIds);
    setRound((r) => r + 1);
  }
  const another = () => {
    setIds({ company: crypto.randomUUID(), contact: crypto.randomUUID(), lead: crypto.randomUUID() });
    setRound((r) => r + 1);
  };
  return <CustomerFormBody key={`${round}|${ids.company}|${ids.contact}|${ids.lead}`} action={action} tenantId={tenantId} ids={ids} onAnother={another} />;
}

function CustomerFormBody({ action, tenantId, ids, onAnother }: { action: Action; tenantId: string; ids: Ids; onAnother: () => void }) {
  const [contactId, setContactId] = useState(ids.contact);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [shop, setShop] = useState("");
  const [how, setHow] = useState("phone_call");
  const [state, formAction, pending] = useActionState(async (prev: CustomerFormState, formData: FormData) => {
    const next = await action(prev, formData);
    if (next?.nextContactId) setContactId(next.nextContactId);
    return next;
  }, undefined);
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
          <Link
            href={`/app/tenants/${tenantId}/customers/new`}
            className="tap"
            onClick={(event) => {
              // A click with a modifier key (new tab, new window, download) or with a button other than the primary one is the browser's own: leave it alone.
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); // restart here with fresh ids; the link itself still works without script
              onAnother();
            }}
          >
            Add another customer
          </Link>
        </p>
      </div>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="card"
      style={{ maxWidth: "40rem" }}
      aria-label="Add a customer"
    >
      <input type="hidden" name="company_id" value={ids.company} />
      <input type="hidden" name="contact_id" value={contactId} />
      <input type="hidden" name="lead_id" value={ids.lead} />
      <label htmlFor="cust-name">Customer&apos;s name</label>
      <input id="cust-name" name="full_name" required value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} disabled={pending} />
      <label htmlFor="cust-phone">WhatsApp or phone number</label>
      <input id="cust-phone" name="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} minLength={3} maxLength={32} inputMode="tel" autoComplete="off" disabled={pending} />
      <label htmlFor="cust-email">E-mail (optional)</label>
      <input id="cust-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" disabled={pending} />
      <label htmlFor="cust-shop">Shop or business name (optional)</label>
      <input id="cust-shop" name="company_name" value={shop} onChange={(e) => setShop(e.target.value)} maxLength={200} disabled={pending} />
      <label htmlFor="cust-how">How did the enquiry come?</label>
      <select id="cust-how" name="how" value={how} onChange={(e) => setHow(e.target.value)} disabled={pending}>
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
