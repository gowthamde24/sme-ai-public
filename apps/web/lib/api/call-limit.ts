import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The business's own calls-a-day limit (the owner's decision, 14 Nov 2026; C1's `GET|PUT /v1/tenants/{id}/tasks/call-limit`): default 100 a day (India day), 1 to 5000, counted: people a plan called today plus outbound phone calls placed today. Read: Owner, Admin, Sales; change: the Owner only, no authenticator code (the screen asks "Change limit to 150 a day?" first). SERVER ONLY.
 */
export type CallLimit = { limit: number; used: number; remaining: number; defaultLimit: number };
export const CALL_LIMIT_MIN = 1;
export const CALL_LIMIT_MAX = 5000;

const whole = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function parseCallLimit(json: unknown): CallLimit {
  const o = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const limit = o ? whole(o.limit) : null;
  const used = o ? whole(o.used) : null;
  const remaining = o ? whole(o.remaining) : null;
  const def = o ? whole(o.default_limit) : null;
  if (limit === null || used === null || remaining === null || def === null) throw new ApiContractError("Unexpected call-limit response.");
  return { limit, used, remaining, defaultLimit: def };
}

const path = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return `/v1/tenants/${tenantId}/tasks/call-limit`;
};

export const readCallLimit = async (token: string, tenantId: string): Promise<CallLimit> => parseCallLimit(await apiRequest(path(tenantId), token));

/** Throws ApiRequestError: 403 `forbidden` (not the Owner), 422 (out of range). */
export async function writeCallLimit(token: string, tenantId: string, limit: number): Promise<CallLimit> {
  if (!Number.isInteger(limit) || limit < CALL_LIMIT_MIN || limit > CALL_LIMIT_MAX) throw new ApiContractError("limit");
  return parseCallLimit(await apiRequest(path(tenantId), token, { method: "PUT", body: JSON.stringify({ limit }) }));
}
