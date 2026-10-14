"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { HOW_IT_CAME } from "@/lib/api/customers";

import type { CustomerFormState } from "./actions";
import { alertBox, btnMain, fieldInput, fieldLabel, formCardWide, link, mutedText } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";
import { CustomFieldsInputs, type FieldInputWords, type FieldValues } from "@/components/v2/app/fields/CustomFieldsInputs";
import type { FormField } from "@/lib/packs/form-fields";

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
export function CustomerForm({ action, tenantId, ids: pageIds, words, fields = [], fieldWords }: { action: Action; tenantId: string; ids: Ids; words?: Words; /** The extra fields of the business type (job CL), already in the person's language. */ fields?: readonly FormField[]; fieldWords?: FieldInputWords }) {
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
  return <CustomerFormBody fields={fields} fieldWords={fieldWords} words={words} key={`${round}|${ids.company}|${ids.contact}|${ids.lead}`} action={action} tenantId={tenantId} ids={ids} onAnother={another} />;
}

function CustomerFormBody({ action, tenantId, ids, onAnother, words, fields, fieldWords }: { action: Action; tenantId: string; ids: Ids; onAnother: () => void; words?: Words; fields: readonly FormField[]; fieldWords?: FieldInputWords }) {
  const t = makeT(words);
  const [contactId, setContactId] = useState(ids.contact);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [shop, setShop] = useState("");
  const [gstin, setGstin] = useState("");
  const [how, setHow] = useState("phone_call");
  const [custom, setCustom] = useState<FieldValues>({});
  const [state, formAction, pending] = useActionState(async (prev: CustomerFormState, formData: FormData) => {
    const next = await action(prev, formData);
    if (next?.nextContactId) setContactId(next.nextContactId);
    return next;
  }, undefined);
  if (state?.ok && state.leadId && state.contactId)
    return (
      <div role="status" className={formCardWide}>
        <p>
          <Rich t={t} k="cust.added_line" with={{ name: <strong>{state.name}</strong> }} />
        </p>
        {state.fieldsNote ? <p role="alert" className={mutedText}>{state.fieldsNote}</p> : null}
        <p className={mutedText}>{t("cust.no_consent_is_recorded_yet_so")}</p>
        <p>
          <Link href={`/app/tenants/${tenantId}/contacts/${state.contactId}/consent`} className={link}>
            {t("cust.record_consent_for_this_person")}
          </Link>
        </p>
        <p>
          <Link href={`/app/tenants/${tenantId}/leads/${state.leadId}`} className={link}>
            {t("cust.open_the_lead")}
          </Link>
          {" · "}
          <Link
            href={`/app/tenants/${tenantId}/customers/new`}
            className={link}
            onClick={(event) => {
              // A click with a modifier key (new tab, new window, download) or with a button other than the primary one is the browser's own: leave it alone.
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); // restart here with fresh ids; the link itself still works without script
              onAnother();
            }}
          >
            {t("cust.add_another_customer")}
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
      className={formCardWide}
      aria-label={t("cust.add_a_customer")}
    >
      <input type="hidden" name="company_id" value={ids.company} />
      <input type="hidden" name="contact_id" value={contactId} />
      <input type="hidden" name="lead_id" value={ids.lead} />
      <label htmlFor="cust-name" className={fieldLabel}>
        {t("cust.customer_s_name")}
      </label>
      <input id="cust-name" name="full_name" required value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} disabled={pending} className={fieldInput} />
      <label htmlFor="cust-phone" className={fieldLabel}>
        {t("cust.whatsapp_or_phone_number")}
      </label>
      <input id="cust-phone" name="phone" required value={phone} onChange={(e) => setPhone(e.target.value)} minLength={3} maxLength={32} inputMode="tel" autoComplete="off" disabled={pending} className={fieldInput} />
      <label htmlFor="cust-email" className={fieldLabel}>
        {t("cust.e_mail_optional")}
      </label>
      <input id="cust-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" disabled={pending} className={fieldInput} />
      <label htmlFor="cust-shop" className={fieldLabel}>
        {t("cust.shop_or_business_name_optional")}
      </label>
      <input id="cust-shop" name="company_name" value={shop} onChange={(e) => setShop(e.target.value)} maxLength={200} disabled={pending} className={fieldInput} />
      <label htmlFor="cust-gstin" className={fieldLabel}>
        {t("gst.customer.optional")}
      </label>
      <input id="cust-gstin" name="gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={30} autoComplete="off" spellCheck={false} disabled={pending} aria-describedby="cust-gstin-hint" className={`${fieldInput} font-mono uppercase`} />
      <p id="cust-gstin-hint" className={mutedText}>
        {t("gst.customer.hint")}
      </p>
      <label htmlFor="cust-how" className={fieldLabel}>
        {t("cust.how_did_the_enquiry_come")}
      </label>
      <select id="cust-how" name="how" value={how} onChange={(e) => setHow(e.target.value)} disabled={pending} className={fieldInput}>
        {HOW_IT_CAME.map((h) => (
          <option key={h} value={h}>
            {t(`cust.how.${h}`)}
          </option>
        ))}
      </select>
      <p className={mutedText}>{t("cust.if_you_leave_the_shop_name")}</p>
      {fields.length > 0 && fieldWords ? (
        <>
          <CustomFieldsInputs fields={fields} values={custom} onChange={setCustom} words={fieldWords} idPrefix="cust-cf" disabled={pending} />
          <input type="hidden" name="custom" value={JSON.stringify(custom)} />
        </>
      ) : null}
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("cust.saving") : t("cust.add_this_customer")}
      </button>
    </form>
  );
}
