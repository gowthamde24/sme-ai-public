import type { AgentRow } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { getAgentsStatus } from "@/lib/api/today";

import { targetPaths } from "../target-path";

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

/**
 * Where each helper's latest event opens: the page of this workspace that its `target` names (an order, a lead, an enquiry or, for a quote, the enquiry it belongs to). A helper whose
 * event has no target (the Main agent's answers, a chat has no screen) or has no event has no entry: the Office shows its words without a link. A rejected session is rethrown.
 */
export async function readEventLinks(accessToken: string, tenantId: string, agents: AgentRow[] | null): Promise<Record<string, string>> {
  const withTarget = (agents ?? []).flatMap((a) => (a.last_event?.target ? [{ agent: a.agent, target: a.last_event.target }] : []));
  if (withTarget.length === 0) return {};
  const where = await targetPaths(accessToken, tenantId, withTarget.map((x) => x.target));
  return Object.fromEntries(withTarget.map((x) => [x.agent, where(x.target)]));
}
