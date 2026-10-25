import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Whether a workspace is READ-ONLY (job DP; docs/contracts/plans-billing.md): its trial ended without a payment (owner decision of 25 Oct 2026). `GET /v1/tenants/{id}/billing/access` answers any member, a Viewer too, with
 * four small fields, so every page can read it. `access: "full"` while the platform's billing switch is off (today). SERVER ONLY, with the signed-in person's own token; the answer is checked, a body that is not the contract
 * is an error and never a guess.
 */
export type Access = { readOnly: false } | { readOnly: true; since: string | null; deleteOn: string | null; daysLeft: number | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && v.length <= 40 ? v.slice(0, 10) : null);

export function parseAccess(json: unknown): Access {
  if (!isRecord(json) || (json.access !== "full" && json.access !== "read_only")) throw new ApiContractError("Unexpected billing access response.");
  if (json.access === "full") return { readOnly: false };
  const left = json.data_days_left;
  return { readOnly: true, since: day(json.read_only_since), deleteOn: day(json.delete_on), daysLeft: typeof left === "number" && Number.isInteger(left) && left >= 0 && left <= 1000 ? left : null };
}

export async function getBillingAccess(accessToken: string, tenantId: string): Promise<Access> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return parseAccess(await apiRequest(`/v1/tenants/${tenantId}/billing/access`, accessToken));
}
