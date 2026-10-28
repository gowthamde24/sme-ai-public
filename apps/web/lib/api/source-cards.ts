import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { parseAuthorize, parseCards, parseEmail, parseKeyResult, parsePages, parseWebsite, type Card, type EmailAddress, type MetaPage, type SourceError, type WebsiteSnippet } from "@/lib/sources/types";

/**
 * The lead-source cards from C1's API (contract-context-sources.md part B), under `/v1/tenants/{id}/lead-sources`, the signed-in person's own token, SERVER SIDE ONLY (Owner and Admin):
 *   GET /cards · POST /meta/connect -> {authorize_url} · GET /meta/pages · POST /meta/pages/{id}/select · POST /meta/disconnect
 *   PUT /indiamart/key {crm_key} -> {status, key_hint} (the key is never returned) · POST /indiamart/disconnect
 *   GET /email-address · POST /email-address/rotate · GET /website
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/lead-sources`;
};
const need = <T>(v: T | null): T => {
  if (v === null) throw new ApiContractError("Unexpected lead-source response.");
  return v;
};
const post = (body: unknown = {}): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export function sourceErrorOf(error: unknown): SourceError {
  if (!(error instanceof ApiRequestError)) return "down";
  if (error.code === "key_rejected" || error.code === "invalid_key" || error.code === "indiamart_key_rejected") return "badkey";
  if (error.code === "not_available" || error.code === "source_unavailable") return "notavailable";
  if (error.status === 409) return "state";
  if (error.status === 429) return "slow";
  return error.status === 403 ? "forbidden" : "down";
}

export const getCards = async (token: string, tenantId: string): Promise<Card[]> => need(parseCards(await apiRequest(`${base(tenantId)}/cards`, token)));
export const metaConnect = async (token: string, tenantId: string): Promise<string> => need(parseAuthorize(await apiRequest(`${base(tenantId)}/meta/connect`, token, post())));
export const metaPages = async (token: string, tenantId: string): Promise<MetaPage[]> => need(parsePages(await apiRequest(`${base(tenantId)}/meta/pages`, token)));
export async function metaSelect(token: string, tenantId: string, pageId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) throw new ApiContractError("id");
  await apiRequest(`${base(tenantId)}/meta/pages/${pageId}/select`, token, post());
}
export const metaDisconnect = async (token: string, tenantId: string): Promise<void> => void (await apiRequest(`${base(tenantId)}/meta/disconnect`, token, post()));
export const indiaMartKey = async (token: string, tenantId: string, crmKey: string) => need(parseKeyResult(await apiRequest(`${base(tenantId)}/indiamart/key`, token, { method: "PUT", body: JSON.stringify({ crm_key: crmKey }) })));
export const indiaMartDisconnect = async (token: string, tenantId: string): Promise<void> => void (await apiRequest(`${base(tenantId)}/indiamart/disconnect`, token, post()));
export const getEmailAddress = async (token: string, tenantId: string): Promise<EmailAddress> => need(parseEmail(await apiRequest(`${base(tenantId)}/email-address`, token)));
export const rotateEmailAddress = async (token: string, tenantId: string): Promise<EmailAddress> => need(parseEmail(await apiRequest(`${base(tenantId)}/email-address/rotate`, token, post())));
export const getWebsite = async (token: string, tenantId: string): Promise<WebsiteSnippet> => need(parseWebsite(await apiRequest(`${base(tenantId)}/website`, token)));
