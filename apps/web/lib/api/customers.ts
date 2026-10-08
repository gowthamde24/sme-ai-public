import { ApiContractError, apiRequest } from "./client";
import { createCompany, isCanonicalUuid } from "./crm";

/**
 * Server-side calls of OUR API for the "add a customer" screen: a company, a contact and a lead, in that order, each with an id the page made (an identical retry is a replay: 200, same row).
 *
 * What comes back is checked for its id only and never rendered: a phone number or an address that the API returns is not read here.
 */
export type HowItCame = "phone_call" | "whatsapp";
export const HOW_IT_CAME: readonly HowItCame[] = ["phone_call", "whatsapp"];
export const HOW_LABELS: Record<HowItCame, string> = { phone_call: "Phone call", whatsapp: "WhatsApp" };

export type ContactInput = { id: string; companyId: string; fullName: string; phone: string; email: string | null };
export type LeadInput = { id: string; companyId: string; contactId: string; source: HowItCame };

function checked(...ids: string[]): void {
  for (const id of ids) if (!isCanonicalUuid(id)) throw new ApiContractError("id");
}
function idOf(json: unknown, what: string): string {
  const id = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>).id : undefined;
  if (typeof id !== "string" || !isCanonicalUuid(id)) throw new ApiContractError(`Unexpected ${what} in a response.`);
  return id;
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/** A prospect company. Idempotent on `id`. */
export async function createCustomerCompany(accessToken: string, tenantId: string, input: { id: string; name: string }): Promise<void> {
  checked(tenantId, input.id);
  await createCompany(accessToken, tenantId, { id: input.id, name: input.name, type: "prospect" });
}

/** A contact with a phone and, only if given, an e-mail. Sales or above; the API keys it on creation. */
export async function createContact(accessToken: string, tenantId: string, input: ContactInput): Promise<string> {
  checked(tenantId, input.id, input.companyId);
  const body = { id: input.id, company_id: input.companyId, full_name: input.fullName, phone: input.phone, ...(input.email !== null && { email: input.email }) };
  return idOf(await apiRequest(`/v1/tenants/${tenantId}/contacts`, accessToken, post(body)), "contact");
}

/** A lead for the contact; its source says how the enquiry came. */
export async function createLead(accessToken: string, tenantId: string, input: LeadInput): Promise<string> {
  checked(tenantId, input.id, input.companyId, input.contactId);
  const body = { id: input.id, company_id: input.companyId, contact_id: input.contactId, source: input.source };
  return idOf(await apiRequest(`/v1/tenants/${tenantId}/leads`, accessToken, post(body)), "lead");
}
