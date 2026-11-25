import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { putSourceCosts } from "./outreach";
import { listSources, setSourceStatus } from "./lead-sources";
import { parseAuthorize, parseCards, parseConnect, parseCosts, parseEmail, parsePages, parsePortals, parseTest, parseWebsite, type Card, type ConnectInfo, type EmailAddress, type MetaPage, type Portal, type SourceError, type TestResult, type WebsiteSnippet } from "@/lib/sources/types";

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
  if (error.code === "consent_required") return "consent_required"; // 422: JOBS' consent tick was not sent (the web shows the same sentence as the tick)
  if (error.code === "not_connected") return "notconnected";
  if (error.code === "source_paused") return "paused";
  if (error.code === "provider_rejected") return "badkey";
  if (error.code === "nothing_to_test" || error.code === "not_available" || error.code === "source_unavailable" || error.status === 404 || error.status === 405) return "notavailable"; // a door the API does not have yet is "not switched on", not "try again"
  if (error.status === 409) return "state";
  if (error.status === 429) return "slow";
  return error.status === 403 ? "forbidden" : "down";
}

/** The cards, each with the owner's cost per lead for its source (a second read, `GET /outreach/source-costs`: a failure of it leaves the box empty, never the cards). */
export async function getCards(token: string, tenantId: string): Promise<Card[]> {
  const [cards, costs] = await Promise.all([apiRequest(`${base(tenantId)}/cards`, token), apiRequest(`/v1/tenants/${tenantId}/outreach/source-costs`, token).then(parseCosts, () => ({}) as Record<string, number>)]);
  return need(parseCards(cards)).map((c) => (c.costSource && costs[c.costSource] !== undefined ? { ...c, costPerLeadPaise: costs[c.costSource] } : c));
}
/** `consent` (JOBS, mock 08): the person ticked "the people who fill this form have agreed to be contacted"; the body then carries `consent_confirmed: true` and the API keeps who and when. Without JOBS the body is empty, as it always was. */
export const metaConnect = async (token: string, tenantId: string, consent = false): Promise<string> => need(parseAuthorize(await apiRequest(`${base(tenantId)}/meta/connect`, token, post(consent ? { consent_confirmed: true } : {}))));
export const metaPages = async (token: string, tenantId: string): Promise<MetaPage[]> => need(parsePages(await apiRequest(`${base(tenantId)}/meta/pages`, token)));
export async function metaSelect(token: string, tenantId: string, pageId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(pageId)) throw new ApiContractError("id");
  await apiRequest(`${base(tenantId)}/meta/pages/${pageId}/select`, token, post());
}
export const metaDisconnect = async (token: string, tenantId: string): Promise<void> => void (await apiRequest(`${base(tenantId)}/meta/disconnect`, token, post()));
/**
 * The owner's own IndiaMART key (contract lead-sources-v2.md, slice 4): `POST /cards/indiamart/connect {key}` asks IndiaMART first and stores nothing when it says no (422 `key_rejected`). The key is sent once and never
 * kept or shown again here; the answer is the card. (The older `PUT /indiamart/key` fallback was removed when this door went live on staging, 15 Nov.)
 */
export async function indiaMartKey(token: string, tenantId: string, crmKey: string): Promise<{ status: "connected" | "needs_attention"; hint: string }> {
  const card = await apiRequest(`${base(tenantId)}/cards/indiamart/connect`, token, post({ key: crmKey }));
  const state = typeof card === "object" && card !== null ? (card as Record<string, unknown>).state : null;
  if (state === "connected" || state === "waiting") return { status: "connected", hint: "" };
  if (state === "needs_attention") return { status: "needs_attention", hint: "" };
  throw new ApiContractError("Unexpected lead-source response.");
}
export const indiaMartDisconnect = async (token: string, tenantId: string): Promise<void> => void (await apiRequest(`${base(tenantId)}/indiamart/disconnect`, token, post()));
export const getEmailAddress = async (token: string, tenantId: string): Promise<EmailAddress> => need(parseEmail(await apiRequest(`${base(tenantId)}/email-address`, token)));
export const rotateEmailAddress = async (token: string, tenantId: string): Promise<EmailAddress> => need(parseEmail(await apiRequest(`${base(tenantId)}/email-address/rotate`, token, post())));
export const getPortals = async (token: string, tenantId: string): Promise<Portal[]> => need(parsePortals(await apiRequest(`${base(tenantId)}/portals`, token)));
export const getWebsite = async (token: string, tenantId: string): Promise<WebsiteSnippet> => need(parseWebsite(await apiRequest(`${base(tenantId)}/website`, token)));

/** The kinds of live source a card stands for (the API's own grouping in `lead_sources/cards.py`). */
const KINDS_OF: Record<string, readonly string[]> = { meta: ["meta_lead_ads"], indiamart: ["indiamart"], email_forward: ["email_forward"], website: ["website_form", "webhook"], google_ads: ["google_ads"], sheets: ["google_sheet"] };
const CARD_IDS = ["website", "missed_calls", "meta", "click_to_whatsapp", "indiamart", "email_forward", "google_ads", "sheets", "files", "whatsapp"];
/** "Test": the API makes ONE marked test lead for this card (never real data, never called or messaged) or checks the address/key (contract lead-sources-v2.md b). */
export async function testCard(token: string, tenantId: string, card: string): Promise<TestResult> {
  if (!CARD_IDS.includes(card)) throw new ApiContractError("card");
  return need(parseTest(await apiRequest(`${base(tenantId)}/cards/${card}/test`, token, post())));
}
/** "Connect" (the website form first): the API makes the address and the card is live; the answer is the card, not read here (the screen reads the cards again). */
export async function connectCard(token: string, tenantId: string, card: string, consent = false): Promise<ConnectInfo | null> {
  if (!CARD_IDS.includes(card)) throw new ApiContractError("card");
  return parseConnect(await apiRequest(`${base(tenantId)}/cards/${card}/connect`, token, post(consent ? { consent_confirmed: true } : {}))); // null for a kind that has no address to show once (the website form shows its own)
}
/** "A new address": the old one stops at once; the screen reads the website snippet again for the new one. */
export async function rotateCard(token: string, tenantId: string, card: string): Promise<ConnectInfo | null> {
  if (!CARD_IDS.includes(card)) throw new ApiContractError("card");
  return parseConnect(await apiRequest(`${base(tenantId)}/cards/${card}/rotate`, token, post()));
}
/** "Disconnect": the key, token or secret is revoked, every lead already received stays. */
export async function disconnectCard(token: string, tenantId: string, card: string): Promise<void> {
  if (!CARD_IDS.includes(card)) throw new ApiContractError("card");
  await apiRequest(`${base(tenantId)}/cards/${card}/disconnect`, token, post());
}
/** "Turn back on": resumes the paused sources of one card. */
export async function resumeCard(token: string, tenantId: string, card: string): Promise<void> {
  const kinds = KINDS_OF[card];
  if (!kinds) throw new ApiContractError("card");
  for (const source of await listSources(token, tenantId)) if (kinds.includes(source.kind) && source.status === "paused") await setSourceStatus(token, tenantId, source.id, "resume");
}

/** What one lead from a card's source costs the owner (rupees entered, kept as paise). `source` is the lead tag; only the one changed is sent (the call replaces the list it is given for those sources). */
export async function setCardCost(token: string, tenantId: string, source: string, costPerLeadPaise: number): Promise<void> {
  if (!/^[a-z0-9_]{1,40}$/.test(source) || !Number.isInteger(costPerLeadPaise) || costPerLeadPaise < 0 || costPerLeadPaise > 10_000_000) throw new ApiContractError("cost");
  await putSourceCosts(token, tenantId, [{ source, costPerLeadPaise }]);
}
