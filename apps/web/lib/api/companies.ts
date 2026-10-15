import { apiRequest } from "./client";
import { isCanonicalUuid, parsePage } from "./crm";

/** A customer as the pickers show it: the name and the city, nothing more. */
export type CompanyHit = { id: string; name: string; city: string | null };

/** Customers by name (the API searches company names): at most `limit` of them, newest first. Used by the pickers of sites, payments and campaigns. */
export async function searchCompanies(accessToken: string, tenantId: string, query: string, limit = 10): Promise<CompanyHit[]> {
  const q = query.trim();
  if (!isCanonicalUuid(tenantId) || q.length > 100) return [];
  const params = new URLSearchParams({ limit: String(limit) });
  if (q.length > 0) params.set("q", q);
  const page = parsePage("companies", await apiRequest(`/v1/tenants/${tenantId}/companies?${params.toString()}`, accessToken));
  return page.entity === "companies" ? page.items.map((c) => ({ id: c.id, name: c.name, city: c.city ?? null })) : [];
}
