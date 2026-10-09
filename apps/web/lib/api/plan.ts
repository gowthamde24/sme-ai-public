import { ApiContractError, apiRequest } from "./client";

/**
 * The plan of a workspace (job AD / D1), read from `GET /v1/tenants/{tenant}` (`plan`, `workspace_limit`, `trial_started_at`). Server side only, with the
 * signed-in user's own token. Read-only for everyone: only the operator changes a plan or a limit.
 */
export interface Plan {
  plan: "free_trial";
  /** how many workspaces one Owner may own on this plan (1 on the free trial) */
  workspace_limit: number;
  /** ISO 8601 */
  trial_started_at: string;
}

export function parsePlan(json: unknown): Plan {
  const bad = (what: string): never => {
    throw new ApiContractError(`Unexpected ${what} in a tenant response.`);
  };
  if (typeof json !== "object" || json === null || Array.isArray(json)) return bad("body");
  const r = json as Record<string, unknown>;
  if (r.plan !== "free_trial") return bad("plan");
  const limit = r.workspace_limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return bad("workspace_limit");
  const started = r.trial_started_at;
  if (typeof started !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(started) || Number.isNaN(Date.parse(started))) return bad("trial_started_at");
  return { plan: "free_trial", workspace_limit: limit, trial_started_at: started };
}

/** `GET /v1/tenants/{tenant}`: the plan fields. Any member. 404 = not found or not a member. */
export async function getPlan(accessToken: string, tenantId: string): Promise<Plan> {
  return parsePlan(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}`, accessToken));
}
