"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createContact, createCustomerCompany, createLead, HOW_IT_CAME, type HowItCame } from "@/lib/api/customers";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";
import { makeT, type Say } from "@/components/v2/app/words";

/** What the screen shows after a press. It never carries the phone number or the e-mail back. */
export type CustomerFormState =
  | { ok?: boolean; error?: string; leadId?: string; contactId?: string; name?: string; nextContactId?: string }
  | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

// The note above is true only when pressing the button again is the right next move. A sentence that tells the person to reload the page, start again or look in the Contacts list must NOT
// carry it (it would contradict the sentence): a conflict, a reference that is gone, a suppressed contact, and any 409 we have no words for.
const PRESS_AGAIN_IS_SAFE_409 = new Set(["duplicate_value", "real_data_gate_closed", "token_expiring"]);
function retryNote(error: unknown, step: number, t: Say): string {
  if (step === 0) return "";
  if (error instanceof ApiRequestError) {
    if (error.code === "invalid_reference" || error.code === "contact_suppressed") return "";
    if (error.status === 409 && !PRESS_AGAIN_IS_SAFE_409.has(error.code)) return "";
  }
  return " " + t("cust.again");
}

/**
 * Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. A replay of the same ids and details is not an error (the API answers 200 and the
 * screen shows success), so no sentence here says "this form was already used": a 409 means a real conflict, and each kind has its own words.
 */
function describe(error: unknown, t: Say = makeT()): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return t("cust.your_role_cannot_add_customers");
    if (error.status === 404) return t("cust.this_workspace_is_not_available");
    if (error.status === 429) return t("cust.too_many_requests_wait_a_moment");
    switch (error.code) {
      case "duplicate_value":
        return t("cust.that_e_mail_is_already_used");
      case "real_data_gate_closed":
        return t("cust.this_workspace_does_not_accept_real");
      case "conflict":
        return t("cust.this_customer_was_already_saved_with");
      case "contact_suppressed":
        return t("cust.this_person_is_on_the_do");
      case "token_expiring":
        return t("cust.your_session_is_about_to_expire");
      case "invalid_reference":
        return t("cust.something_this_customer_depends_on_is");
      case "invalid_value":
        return t("cust.a_value_was_not_accepted_check");
      case "validation_error":
        return t("cust.check_the_name_the_number_3");
    }
    if (error.status === 409) return t("cust.this_could_not_be_saved_right");
    if (error.status === 422) return t("cust.check_the_name_the_number_3");
  }
  return t("cust.could_not_save_try_again");
}

/**
 * Add a customer: a company, a contact (a phone, an e-mail only if given) and a lead, in that order, with the ids the page made, so a second press is a retry and
 * duplicates nothing. The shop name is optional; without it the person's name is the company's, because a lead that names a contact needs a company. No consent is recorded here.
 */
export async function addCustomerAction(tenantId: string, _prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const t = await serverT(["cust."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("cust.this_workspace_is_not_available") };
  const companyId = field(formData, "company_id");
  const contactId = field(formData, "contact_id");
  const leadId = field(formData, "lead_id");
  if (![companyId, contactId, leadId].every(isCanonicalUuid)) return { ok: false, error: t("cust.this_form_is_out_of_date") };
  const fullName = field(formData, "full_name");
  const shop = field(formData, "company_name");
  const phone = field(formData, "phone");
  const email = field(formData, "email");
  const how = field(formData, "how") as HowItCame;
  if (fullName.length < 1 || fullName.length > 200) return { ok: false, error: t("cust.enter_the_customer_s_name_up") };
  if (shop.length > 200) return { ok: false, error: t("cust.the_shop_name_is_too_long") };
  if (phone.length < 3 || phone.length > 32) return { ok: false, error: t("cust.enter_the_whatsapp_or_phone_number") };
  if (email.length > 254) return { ok: false, error: t("cust.the_e_mail_is_too_long") };
  if (!HOW_IT_CAME.includes(how)) return { ok: false, error: t("cust.choose_how_the_enquiry_came") };

  let step = 0;
  try {
    await createCustomerCompany(user.accessToken, tenantId, { id: companyId, name: shop || fullName });
    step = 1;
    await createContact(user.accessToken, tenantId, { id: contactId, companyId, fullName, phone, email: email === "" ? null : email });
    step = 2;
    await createLead(user.accessToken, tenantId, { id: leadId, companyId, contactId, source: how });
  } catch (error) {
    const duplicateEmail = step === 1 && error instanceof ApiRequestError && error.code === "duplicate_value";
    // A duplicate e-mail means the contact was NOT made (the company was). The next try uses a FRESH contact id and the SAME company and lead ids: the company replays, nothing is added twice.
    return { ok: false, error: describe(error, t) + retryNote(error, step, t), ...(duplicateEmail && { nextContactId: randomUUID() }) };
  }
  revalidatePath(`/app/tenants/${tenantId}`);
  return { ok: true, leadId, contactId, name: fullName };
}
