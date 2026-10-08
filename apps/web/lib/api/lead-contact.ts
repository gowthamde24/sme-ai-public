import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The id of the contact a lead is linked to, or null when it has none. Used only to point at the consent page of that person. The lead row the CRM client parses leaves this field out, so this reads
 * the one field it needs from the same endpoint (`GET /leads/{id}`); nothing else of the row (and nothing about the person) is read or kept.
 */
export async function fetchLeadContactId(accessToken: string, tenantId: string, leadId: string): Promise<string | null> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) throw new ApiContractError("id");
  const json = await apiRequest(`/v1/tenants/${tenantId}/leads/${leadId}`, accessToken);
  if (typeof json !== "object" || json === null || Array.isArray(json) || !("contact_id" in json)) throw new ApiContractError("Unexpected lead in a response.");
  const id = (json as Record<string, unknown>).contact_id;
  if (id === null) return null;
  if (typeof id !== "string" || !isCanonicalUuid(id)) throw new ApiContractError("Unexpected lead in a response.");
  return id;
}
