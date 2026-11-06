import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * C1's records search for the ⌘K palette (docs/contracts/search.md): `GET /v1/tenants/{t}/search?q=` (2 to 80 characters), any member, each row what that person may already see (RLS), at most 5 per kind. A server without the route
 * yet (404) answers no groups: the palette then has its pages and actions only. The palette routes a record by its kind and id (lib: palette.recordHref), never by an address the API wrote.
 */
export const SEARCH_KINDS = ["lead", "customer", "quote", "order", "student"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export type SearchItem = { kind: SearchKind; id: string; title: string; sub: string | null };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const short = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);

export function parseSearch(json: unknown): SearchItem[] {
  if (!isRec(json) || !Array.isArray(json.groups)) throw new ApiContractError("Unexpected search body.");
  const out: SearchItem[] = [];
  for (const g of json.groups) {
    if (!isRec(g) || !(SEARCH_KINDS as readonly unknown[]).includes(g.kind) || !Array.isArray(g.items)) continue;
    for (const it of g.items.slice(0, 5)) {
      if (!isRec(it) || typeof it.id !== "string" || !isCanonicalUuid(it.id)) continue;
      const title = short(it.title, 120);
      if (title) out.push({ kind: g.kind as SearchKind, id: it.id, title, sub: short(it.sub, 160) });
    }
  }
  return out;
}

export async function searchRecords(token: string, tenantId: string, q: string): Promise<SearchItem[]> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const query = q.trim();
  if (query.length < 2 || query.length > 80) return [];
  try {
    return parseSearch(await apiRequest(`/v1/tenants/${tenantId}/search?${new URLSearchParams({ q: query }).toString()}`, token));
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) return [];
    throw error;
  }
}
