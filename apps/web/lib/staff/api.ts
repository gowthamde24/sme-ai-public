import { apiRequest } from "@/lib/api/client";

import { type AccessGrant, type BusinessList, type BusinessRow, type GoodwillResult, type Overview, type SearchResults, type StaffMe, type SupportView, type TicketList, type TicketStatus, type TicketThread, type Unmasked, parseAccess, parseBusinessList, parseBusinessRow, parseGoodwill, parseMe, parseOverview, parseSearch, parseSupportView, parseThread, parseTicketList, parseUnmasked } from "./types";

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

const post = (token: string, path: string, body: unknown) => apiRequest(path, token, { method: "POST", body: JSON.stringify(body) });
const reasonBody = (code: string, text: string | null) => ({ reason_code: code, ...(text ? { reason_text: text } : {}) });

// Phase 2 (14 Nov): the support inbox and thread, the businesses list, pause / resume, goodwill credit and unmasking.
export async function apiTickets(token: string, status: TicketStatus | "active"): Promise<TicketList> {
  return parseTicketList(await apiRequest(`/v1/admin/support/tickets?status=${enc(status)}&limit=50`, token));
}
export async function apiThread(token: string, id: string): Promise<TicketThread> {
  return parseThread(await apiRequest(`/v1/admin/support/tickets/${enc(id)}`, token));
}
export async function apiReply(token: string, id: string, body: string, kind: "reply" | "note"): Promise<TicketThread> {
  return parseThread(await post(token, `/v1/admin/support/tickets/${enc(id)}/reply`, { body, kind }));
}
export async function apiTicketStatus(token: string, id: string, status: TicketStatus): Promise<TicketThread> {
  return parseThread(await post(token, `/v1/admin/support/tickets/${enc(id)}/status`, { status }));
}
export async function apiAssign(token: string, id: string, staffId: string | null): Promise<TicketThread> {
  return parseThread(await post(token, `/v1/admin/support/tickets/${enc(id)}/assign`, { staff_id: staffId }));
}
export async function apiBusinesses(token: string, q: string, cursor: string | null): Promise<BusinessList> {
  const query = new URLSearchParams({ sort: "last_activity", limit: "30" });
  if (q) query.set("q", q);
  if (cursor) query.set("cursor", cursor);
  return parseBusinessList(await apiRequest(`/v1/admin/businesses?${query.toString()}`, token));
}
export async function apiPause(token: string, tenantId: string, code: string, text: string | null): Promise<BusinessRow> {
  return parseBusinessRow(await post(token, `/v1/admin/businesses/${enc(tenantId)}/assistant/pause`, reasonBody(code, text)));
}
export async function apiResume(token: string, tenantId: string, code: string, text: string | null): Promise<BusinessRow> {
  return parseBusinessRow(await post(token, `/v1/admin/businesses/${enc(tenantId)}/assistant/resume`, reasonBody(code, text)));
}
export async function apiGoodwill(token: string, tenantId: string, input: { amountPaise: number; confirmPaise: number; code: string; text: string; key: string }): Promise<GoodwillResult> {
  return parseGoodwill(await post(token, `/v1/admin/businesses/${enc(tenantId)}/goodwill-credit`, { amount_paise: input.amountPaise, confirm_paise: input.confirmPaise, reason_code: input.code, reason_text: input.text, idempotency_key: input.key }));
}
export async function apiUnmask(token: string, tenantId: string, accessId: string, code: string, text: string): Promise<Unmasked> {
  return parseUnmasked(await post(token, `/v1/admin/businesses/${enc(tenantId)}/unmask`, { access_id: accessId, ...reasonBody(code, text) }));
}
