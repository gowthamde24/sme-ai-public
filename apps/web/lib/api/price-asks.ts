import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, nstr, oneOf, optStr, readRows, rec, str, uuid } from "./shape";

/**
 * What the shop told a customer it would come back to (C1, 15-16 Nov; contract docs/contracts/today-summary.md, section `price_asks`): `GET /price-asks?open=true&limit=20` (Owner, Admin, Sales) and `POST /price-asks/{id}/answered`. `kind` is `price` ("Price asked: X": the assistant could not state a price)
 * or `follow_up` ("Promised: X": "we will check / send / confirm"); `needed_by` is the day the customer named (India time, YYYY-MM-DD) or null; the list is earliest deadline first. A row that is not the contract's shape is left out and the rest still show.
 */
export type PriceAskKind = "price" | "follow_up";
export interface PriceAsk {
  id: string;
  item: string;
  kind: PriceAskKind;
  /** YYYY-MM-DD, India time, or null. */
  neededBy: string | null;
  leadId: string | null;
  customer: string | null;
  /** ISO 8601 */
  askedAt: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function parsePriceAsk(json: unknown): PriceAsk {
  const x = rec(json, "price ask");
  const by = optStr(x.needed_by, "needed_by", 10);
  const at = str(x.asked_at, "asked_at", 40);
  if (Number.isNaN(Date.parse(at))) bad("asked_at");
  const lead = optStr(x.lead_id, "lead_id", 40);
  const customer = optStr(x.customer, "customer", 120);
  return {
    id: uuid(x.id, "id"),
    item: nstr(x.item, "item", 200),
    kind: oneOf(x.kind ?? "price", ["price", "follow_up"] as const, "kind"), // an API from before `kind` sent only price questions
    neededBy: by !== null && DAY.test(by) ? by : null,
    leadId: lead !== null && isCanonicalUuid(lead) ? lead : null,
    customer: customer !== null && customer.trim() !== "" ? customer.trim() : null,
    askedAt: at,
  };
}
export const parsePriceAsks = (json: unknown): PriceAsk[] => readRows(rec(json, "price asks").items, "price asks", parsePriceAsk, 50);

const base = (tenantId: string): string => (isCanonicalUuid(tenantId) ? `/v1/tenants/${tenantId}` : bad("workspace id"));
/** The open ones, earliest deadline first as the API sends them. */
export async function listPriceAsks(token: string, tenantId: string): Promise<PriceAsk[]> {
  return parsePriceAsks(await apiRequest(`${base(tenantId)}/price-asks?open=true&limit=20`, token));
}
/** "Done": the person answered, the item leaves Today. */
export async function markPriceAskAnswered(token: string, tenantId: string, id: string): Promise<void> {
  if (!isCanonicalUuid(id)) bad("price ask id");
  await apiRequest(`${base(tenantId)}/price-asks/${id}/answered`, token, { method: "POST" });
}
