import { AGENT_KEYS, type AgentKey } from "./today";
import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * A switch per helper (C1's docs/contracts/agents-switches.md, 5 Nov 2026), with the signed-in person's own token:
 *
 *   GET /v1/tenants/{t}/agents/switches          Owner, Admin -> [{agent, enabled, can_switch, reason_locked, done_today}]
 *   PUT /v1/tenants/{t}/agents/{agent}/switch    Owner {enabled: true | false} -> the same item; 409 not_switchable, 404 unknown helper
 *
 * The switch is enforced where every run starts: a helper switched off cannot start one. `can_switch: false` says why in `reason_locked` (`not_built`: a feature with no switch of its own yet; the screen
 * draws no toggle for it). `done_today`: runs that finished well today (India day) for the helpers that run; null for the others.
 */
export type AgentSwitch = { agent: AgentKey; enabled: boolean; canSwitch: boolean; reasonLocked: "platform" | "workspace_off" | "not_built" | null; doneToday: number | null };
const REASONS = ["platform", "workspace_off", "not_built"] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseSwitch(v: unknown): AgentSwitch {
  if (!isRecord(v) || !(AGENT_KEYS as readonly unknown[]).includes(v.agent) || typeof v.enabled !== "boolean" || typeof v.can_switch !== "boolean") throw new ApiContractError("Unexpected helper switch.");
  if (v.reason_locked !== null && !(REASONS as readonly unknown[]).includes(v.reason_locked)) throw new ApiContractError("Unexpected helper switch reason.");
  const done = v.done_today;
  if (done !== null && (typeof done !== "number" || !Number.isSafeInteger(done) || done < 0)) throw new ApiContractError("Unexpected helper count.");
  return { agent: v.agent as AgentKey, enabled: v.enabled, canSwitch: v.can_switch, reasonLocked: v.reason_locked as AgentSwitch["reasonLocked"], doneToday: done as number | null };
}

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/agents`;
};

export async function getAgentSwitches(token: string, tenantId: string): Promise<AgentSwitch[]> {
  const json = await apiRequest(`${base(tenantId)}/switches`, token);
  if (!Array.isArray(json) || json.length > 20) throw new ApiContractError("Unexpected helper switches.");
  return json.map(parseSwitch);
}

export async function putAgentSwitch(token: string, tenantId: string, agent: AgentKey, enabled: boolean): Promise<AgentSwitch> {
  if (!(AGENT_KEYS as readonly string[]).includes(agent)) throw new ApiContractError("agent");
  return parseSwitch(await apiRequest(`${base(tenantId)}/${agent}/switch`, token, { method: "PUT", body: JSON.stringify({ enabled }) }));
}
