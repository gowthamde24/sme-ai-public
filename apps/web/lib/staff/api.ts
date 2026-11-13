import { apiRequest } from "@/lib/api/client";

import { type AccessGrant, type Overview, type SearchResults, type StaffMe, type SupportView, parseAccess, parseMe, parseOverview, parseSearch, parseSupportView } from "./types";

/**
 * C1's staff console routes (`/v1/admin/*`, docs/contracts/admin-console.md "C1: PHASE 1 IS BUILT"), called from the web's SERVER with the signed-in person's own token. Every call needs the second factor (the API says 403 second_factor_required if the
 * session has none) and a staff row (403 not_staff); the API re-checks both on every request, nothing here decides access. SERVER ONLY.
 */
const enc = encodeURIComponent;

export async function apiMe(token: string): Promise<StaffMe> {
  return parseMe(await apiRequest("/v1/admin/me", token));
}
export async function apiOverview(token: string): Promise<Overview> {
  return parseOverview(await apiRequest("/v1/admin/overview", token));
}
export async function apiSearch(token: string, q: string): Promise<SearchResults> {
  return parseSearch(await apiRequest(`/v1/admin/search?q=${enc(q)}`, token));
}
export async function apiAccess(token: string, tenantId: string, reasonCode: string, reasonText: string | null): Promise<AccessGrant> {
  const body = { tenant_id: tenantId, scope: "profile", reason_code: reasonCode, ...(reasonText ? { reason_text: reasonText } : {}) };
  return parseAccess(await apiRequest("/v1/admin/access", token, { method: "POST", body: JSON.stringify(body) }));
}
export async function apiBusinessView(token: string, tenantId: string, accessId: string): Promise<SupportView> {
  return parseSupportView(await apiRequest(`/v1/admin/businesses/${enc(tenantId)}?access_id=${enc(accessId)}`, token));
}
