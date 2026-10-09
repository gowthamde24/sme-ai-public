import type { AgentRow } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { getAgentsStatus } from "@/lib/api/today";

/**
 * The seven helpers and their state, from `getAgentsStatus()` of lib/api (Job AD): always all seven, in the contract's order. null = they could not be read (the screen says "Not available yet");
 * a rejected session is rethrown so the page can send the person to sign in. The existing agent-runs read is the page "Runs and cost" (/agents).
 */
export async function readAgentsStatus(accessToken: string, tenantId: string): Promise<AgentRow[] | null> {
  try {
    return await getAgentsStatus(accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
