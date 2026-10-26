import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { isCategory, isResult, type Outcome, type OutcomeTotals } from "@/lib/outcomes/types";

/**
 * What happened after a call or a WhatsApp follow-up, from C1's API (job DO; docs/contracts/outcomes.md). Server side only, with the signed-in person's own token. Three reads and one act:
 * `GET /customers/{lead}/outcomes` (Owner, Admin, Sales), `GET /outcomes/totals` (any member) and `POST /outcomes/{id}/correct` (Owner, Admin). Every answer is checked: a value that is not in its closed list is a contract error,
 * never drawn. A school's `reason` is always null (no child data): the screens draw the category's fixed words.
 */
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in an outcomes response.`);
};
const count = (v: unknown, what: string): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : bad(what));

export function parseCustomerOutcome(json: unknown): Outcome {
  if (!isRecord(json)) return bad("outcome");
  const { id, channel, at, result, category, reason, corrected } = json;
  if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) return bad("outcome id");
  if (channel !== "call" && channel !== "whatsapp") return bad("outcome channel");
  if (typeof at !== "string" || at.length > 40 || Number.isNaN(Date.parse(at))) return bad("outcome time");
  if (!isResult(result)) return bad("outcome result");
  if (category !== null && !isCategory(category)) return bad("outcome category");
  if (reason !== null && (typeof reason !== "string" || reason.length > 600)) return bad("outcome reason");
  if (typeof corrected !== "boolean") return bad("outcome corrected");
  return { id, channel, at, result, category, reason: reason === null || reason.trim() === "" ? null : reason, corrected };
}

/** `GET /v1/tenants/{tenant}/customers/{lead}/outcomes`: newest first. */
export async function getCustomerOutcomes(accessToken: string, tenantId: string, leadId: string): Promise<Outcome[]> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) throw new ApiContractError("id");
  const json = await apiRequest(`/v1/tenants/${tenantId}/customers/${leadId}/outcomes?limit=20`, accessToken);
  if (!Array.isArray(json) || json.length > 100) return bad("outcome list");
  return json.map(parseCustomerOutcome);
}

/** `GET /v1/tenants/{tenant}/outcomes/totals`: today in India. `total` is the three counts; "not interested" is the one category of the negative ones (`days[0].by_category`). */
export function parseTotals(json: unknown): OutcomeTotals {
  if (!isRecord(json) || !isRecord(json.total)) return bad("totals");
  const positive = count(json.total.positive, "positive");
  const negative = count(json.total.negative, "negative");
  const unclear = count(json.total.unclear, "unclear");
  const first = Array.isArray(json.days) && isRecord(json.days[0]) && isRecord(json.days[0].by_category) ? json.days[0].by_category : null;
  const notInterested = first ? Math.min(count(first.not_interested, "not_interested"), negative) : negative;
  return { positive, negative, unclear, notInterested };
}
export async function getOutcomeTotals(accessToken: string, tenantId: string): Promise<OutcomeTotals> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return parseTotals(await apiRequest(`/v1/tenants/${tenantId}/outcomes/totals`, accessToken));
}

/** `POST /v1/tenants/{tenant}/outcomes/{id}/correct`: a result and a category that belong together (the API answers 422 otherwise; `null` only for "unclear"). The old reason is dropped by the API. */
export async function postOutcomeCorrection(accessToken: string, tenantId: string, id: string, result: string, category: string | null): Promise<void> {
  if (!isCanonicalUuid(tenantId) || !/^[a-z0-9-]{1,40}$/.test(id)) throw new ApiContractError("id");
  await apiRequest(`/v1/tenants/${tenantId}/outcomes/${id}/correct`, accessToken, { method: "POST", body: JSON.stringify({ result, category }) });
}
