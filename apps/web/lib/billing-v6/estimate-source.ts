import { ApiAuthError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { balanceScreens } from "@/lib/screens/flag";

import { mockEstimate, parseEstimate, type Estimate } from "./estimate";

/**
 * Where a plan card gets its estimate: `1` = C1's `POST /v1/tenants/{t}/billing/estimate {calls, avg_minutes}`, `mock` = the made-up rate (lib/billing-v6/estimate.ts), off = nothing (the caller uses the plan's own numbers). A failed or odd answer is null. SERVER ONLY.
 */
export async function readEstimate(accessToken: string, tenantId: string, calls: number, avgMinutes: number): Promise<Estimate | null> {
  const mode = balanceScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId) || !Number.isFinite(calls) || !Number.isFinite(avgMinutes) || calls < 0 || avgMinutes <= 0) return null;
  if (mode === "mock") return mockEstimate(calls, avgMinutes);
  try {
    return parseEstimate(await apiRequest(`/v1/tenants/${tenantId}/billing/estimate`, accessToken, { method: "POST", body: JSON.stringify({ calls: Math.round(calls), avg_minutes: avgMinutes }) }));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
