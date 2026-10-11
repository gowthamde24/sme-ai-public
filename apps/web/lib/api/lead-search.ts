import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * "Find a lead" (job AY, `GET /leads/search?q=`): by the customer's name, a contact's name, or the END of a phone number (four digits or more). Every member. The answer carries the contact's short name
 * ("Priya S.") and the last four digits only, NEVER the number. Server side only, with the person's own token.
 */
export interface LeadHit {
  leadId: string;
  customer: string | null;
  city: string | null;
  contactName: string | null;
  phoneLast4: string | null;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a lead search response.`);
};
const nullableStr = (v: unknown, what: string, max: number): string | null => (v === null || v === undefined ? null : typeof v === "string" && v.length <= max ? v : bad(what));

export function parseLeadSearch(json: unknown): { items: LeadHit[]; next_cursor: string | null } {
  if (!isRecord(json) || !Array.isArray(json.items) || json.items.length > 50) return bad("page");
  const cursor = json.next_cursor;
  if (cursor !== null && cursor !== undefined && (typeof cursor !== "string" || cursor.length > 400)) return bad("next_cursor");
  return {
    items: json.items.map((row): LeadHit => {
      if (!isRecord(row)) return bad("lead");
      const last4 = nullableStr(row.phone_last4, "phone_last4", 4);
      return {
        leadId: typeof row.lead_id === "string" && isCanonicalUuid(row.lead_id) ? row.lead_id : bad("lead_id"),
        customer: nullableStr(row.customer, "customer", 200),
        city: nullableStr(row.city, "city", 200),
        contactName: nullableStr(row.contact_name, "contact_name", 200),
        phoneLast4: last4 !== null && /^\d{4}$/.test(last4) ? last4 : null,
      };
    }),
    next_cursor: typeof cursor === "string" ? cursor : null,
  };
}

/** The shortest and longest search the API accepts. */
export const LEAD_QUERY_MIN = 2;
export const LEAD_QUERY_MAX = 60;

export async function searchLeads(accessToken: string, tenantId: string, query: string, limit = 8): Promise<LeadHit[]> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const q = query.trim();
  if (q.length < LEAD_QUERY_MIN || q.length > LEAD_QUERY_MAX) return [];
  return parseLeadSearch(await apiRequest(`/v1/tenants/${tenantId}/leads/search?q=${encodeURIComponent(q)}&limit=${limit}`, accessToken)).items;
}
