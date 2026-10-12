import { apiRequest, apiStreamRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { readSse } from "./assistant";
import { mapsLink, MAX_CARDS } from "./retailers-checks";
import { bad, bool, isRec, optInt, rec, str, uuid, word } from "./shape";

/**
 * Find retailers (job CC, screen 3; ADR 0078, the contract is in job BP's report). There is no search route of its own: the search is a question to Agent OWL ("find retailers ..."), which has one tool for it, the official
 * Google Places service, switched on by the system's owner. This module asks the question and keeps only what the screen draws: the place cards (a stable id, a name and a Maps link), the words of the answer, and an
 * error if the assistant refused. Google's terms let us show these cards now and keep nothing but the place's identity, so nothing here stores a card, and the answer's own text is the one the API already scrubbed of names
 * and addresses. A lead is made only by `confirmPlace`, from details the person TYPES. Server side only, with the person's own token.
 */
export const TOOLS = ["web_search", "read_page", "find_retailers", "metal_prices"] as const;
export interface ToolStatus {
  enabled: boolean;
  used_today: number | null;
  daily_limit: number | null;
}
export type ResearchStatus = Record<(typeof TOOLS)[number], ToolStatus>;

export function parseResearchStatus(json: unknown): ResearchStatus {
  const tools = rec(rec(json, "status").tools, "tools");
  const out = {} as ResearchStatus;
  for (const name of TOOLS) {
    const t = rec(tools[name], name);
    out[name] = { enabled: bool(t.enabled, "enabled"), used_today: optInt(t.used_today, "used_today", 0, 1_000_000), daily_limit: optInt(t.daily_limit, "daily_limit", 0, 1_000_000) };
  }
  return out;
}
export async function getResearchStatus(token: string, tenantId: string): Promise<ResearchStatus> {
  if (!isCanonicalUuid(tenantId)) bad("workspace id");
  return parseResearchStatus(await apiRequest(`/v1/tenants/${tenantId}/research/status`, token));
}

export interface PlaceCard {
  id: string;
  /** The name Google gives the place, drawn on the card only. */
  label: string;
  /** A Google Maps link, or null when the address is not one the screen will link to. */
  url: string | null;
}
export interface SearchResult {
  cards: PlaceCard[];
  text: string;
  /** A refusal from the assistant itself (agents off, the AI allowance used, too many questions): a closed code. */
  error: string | null;
}

export async function searchRetailers(token: string, tenantId: string, input: { messageId: string; text: string }): Promise<SearchResult> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(input.messageId)) bad("id");
  const response = await apiStreamRequest(`/v1/tenants/${tenantId}/assistant/messages`, token, { message_id: input.messageId, text: input.text.slice(0, 400) });
  const cards: PlaceCard[] = [];
  let text = "";
  let error: string | null = null;
  for await (const { name, data } of readSse(response.body as ReadableStream<Uint8Array>)) {
    if (!isRec(data)) continue;
    if (name === "text" && typeof data.delta === "string") text += data.delta;
    else if (name === "source" && data.kind === "place") {
      if (cards.length < MAX_CARDS) cards.push({ id: uuid(data.id, "place id"), label: str(data.label, "place label", 200), url: mapsLink(data.url) });
    } else if (name === "error") error = word(data.code, "error code", 60);
  }
  return { cards, text: text.slice(0, 4000), error };
}

export interface ConfirmedPlace {
  company_id: string;
  lead_id: string;
  created: boolean;
}
export function parseConfirmedPlace(json: unknown): ConfirmedPlace {
  const x = rec(json, "place");
  return { company_id: uuid(x.company_id, "company_id"), lead_id: uuid(x.lead_id, "lead_id"), created: bool(x.created, "created") };
}
/**
 * `POST /places/confirm`: the person confirms a shop and TYPES its name and city. The card's own id stands in for the place ID (the stream does not carry Google's: its id is a stable id made from it, so the same place
 * is always the same lead). Owner, Admin and Sales.
 */
export async function confirmPlace(token: string, tenantId: string, input: { placeId: string; companyName: string; city?: string; region?: string }): Promise<ConfirmedPlace> {
  if (!isCanonicalUuid(tenantId) || !/^[A-Za-z0-9_-]{10,90}$/.test(input.placeId)) bad("place id");
  const body: Record<string, string> = { place_id: input.placeId, company_name: input.companyName.trim() };
  if (input.city?.trim()) body.city = input.city.trim();
  if (input.region?.trim()) body.region = input.region.trim();
  return parseConfirmedPlace(await apiRequest(`/v1/tenants/${tenantId}/places/confirm`, token, { method: "POST", body: JSON.stringify(body) }));
}


export { mapsLink, queryProblem, questionOf, MAX_CARDS } from "./retailers-checks";
