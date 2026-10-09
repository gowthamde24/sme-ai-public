import type { AgentRow } from "@/components/v2/app/today/types";

/**
 * The seven agents and their state. `getAgentsStatus()` (lib/api, Job AD, Claude 1) does not exist yet, so this is null and the Office says "Not available yet". When it lands, REPLACE the
 * body with that call (its rows have this shape: { agent, state: idle | working | not_available, job, last_event }). The existing agent-runs read is the page "Runs and cost" (/agents).
 */
export async function readAgentsStatus(_accessToken: string, _tenantId: string): Promise<AgentRow[] | null> {
  return null;
}
