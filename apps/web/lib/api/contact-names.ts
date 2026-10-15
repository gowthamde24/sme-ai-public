import { apiRequest } from "./client";
import { isCanonicalUuid, parsePage } from "./crm";

/** A contact as a picker shows it: the name, nothing more (no phone number, no e-mail address). */
export type ContactName = { id: string; name: string };

/** The newest contacts of the business (at most `limit`, the API's own largest page is 100), for the guardian picker of a school. The API searches company names only, so the screen filters these by name itself. */
export async function listContactNames(accessToken: string, tenantId: string, limit = 100): Promise<ContactName[]> {
  if (!isCanonicalUuid(tenantId)) return [];
  const page = parsePage("contacts", await apiRequest(`/v1/tenants/${tenantId}/contacts?limit=${Math.min(Math.max(limit, 1), 100)}`, accessToken));
  return page.entity === "contacts" ? page.items.map((c) => ({ id: c.id, name: c.full_name })) : [];
}
