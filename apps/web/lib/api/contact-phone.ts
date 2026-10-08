import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The stored phone of one contact, or null when it has none. SERVER ONLY, and only the WhatsApp redirect route may import this file (test/whatsapp-guard.test.ts): the number is read there, on the server, with the person's
 * own token, used for one redirect response and never put in a page, a prop, an action result, an error or a log line (docs/plans/open-in-whatsapp-plan.md, section 2). Nothing else of the contact is read or kept.
 * An answer of the wrong shape is a contract error with a fixed message; the message never contains the value.
 */
export async function fetchContactPhone(accessToken: string, tenantId: string, contactId: string): Promise<string | null> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(contactId)) throw new ApiContractError("id");
  const json = await apiRequest(`/v1/tenants/${tenantId}/contacts/${contactId}`, accessToken);
  if (typeof json !== "object" || json === null || Array.isArray(json) || !("phone" in json)) throw new ApiContractError("Unexpected contact in a response.");
  const phone = (json as Record<string, unknown>).phone;
  if (phone === null) return null;
  if (typeof phone !== "string") throw new ApiContractError("Unexpected contact in a response.");
  return phone;
}
