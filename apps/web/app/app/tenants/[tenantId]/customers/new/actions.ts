"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createContact, createCustomerCompany, createLead, HOW_IT_CAME, type HowItCame } from "@/lib/api/customers";
import { requireUser } from "@/lib/auth/session";

/** What the screen shows after a press. It never carries the phone number or the e-mail back. */
export type CustomerFormState =
  | { ok?: boolean; error?: string; leadId?: string; contactId?: string; name?: string; nextContactId?: string }
  | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const AGAIN = " Nothing is added twice if you press the button again.";

/**
 * Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. A replay of the same ids and details is not an error (the API answers 200 and the
 * screen shows success), so no sentence here says "this form was already used": a 409 means a real conflict, and each kind has its own words.
 */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return "Your role cannot add customers.";
    if (error.status === 404) return "This workspace is not available.";
    if (error.status === 429) return "Too many requests. Wait a moment and try again.";
    switch (error.code) {
      case "duplicate_value":
        return "That e-mail is already used by another person.";
      case "real_data_gate_closed":
        return "This workspace does not accept real phone numbers or e-mail addresses yet. Use a number that starts with +00 and an e-mail that ends in .test.";
      case "conflict":
        return "This customer was already saved with different details. Reload the page and look in the Contacts list before adding again.";
      case "contact_suppressed":
        return "This person is on the do-not-contact list, so a lead cannot be made for them. Ask the owner.";
      case "token_expiring":
        return "Your session is about to expire. Sign in again, then try once more.";
      case "invalid_reference":
        return "Something this customer depends on is no longer there. Reload the page and start again.";
      case "invalid_value":
        return "A value was not accepted. Check the number and the e-mail, then try again.";
      case "validation_error":
        return "Check the name, the number (3 to 32 characters) and the e-mail, then try again.";
    }
    if (error.status === 409) return "This could not be saved right now. Reload the page and look in the Contacts list before trying again.";
    if (error.status === 422) return "Check the name, the number (3 to 32 characters) and the e-mail, then try again.";
  }
  return "Could not save. Try again.";
}

/**
 * Add a customer: a company, a contact (a phone, an e-mail only if given) and a lead, in that order, with the ids the page made, so a second press is a retry and
 * duplicates nothing. The shop name is optional; without it the person's name is the company's, because a lead that names a contact needs a company. No consent is recorded here.
 */
export async function addCustomerAction(tenantId: string, _prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "This workspace is not available." };
  const companyId = field(formData, "company_id");
  const contactId = field(formData, "contact_id");
  const leadId = field(formData, "lead_id");
  if (![companyId, contactId, leadId].every(isCanonicalUuid)) return { ok: false, error: "This form is out of date. Reload the page and try again." };
  const fullName = field(formData, "full_name");
  const shop = field(formData, "company_name");
  const phone = field(formData, "phone");
  const email = field(formData, "email");
  const how = field(formData, "how") as HowItCame;
  if (fullName.length < 1 || fullName.length > 200) return { ok: false, error: "Enter the customer's name (up to 200 characters)." };
  if (shop.length > 200) return { ok: false, error: "The shop name is too long (up to 200 characters)." };
  if (phone.length < 3 || phone.length > 32) return { ok: false, error: "Enter the WhatsApp or phone number (3 to 32 characters)." };
  if (email.length > 254) return { ok: false, error: "The e-mail is too long." };
  if (!HOW_IT_CAME.includes(how)) return { ok: false, error: "Choose how the enquiry came." };

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
    return { ok: false, error: describe(error) + (step > 0 ? AGAIN : ""), ...(duplicateEmail && { nextContactId: randomUUID() }) };
  }
  revalidatePath(`/app/tenants/${tenantId}`);
  return { ok: true, leadId, contactId, name: fullName };
}
