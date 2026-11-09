"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { putAgentSwitch, type AgentSwitch } from "@/lib/api/agent-switches";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { AGENT_KEYS, type AgentKey } from "@/lib/api/today";
import { requireUser } from "@/lib/auth/session";

/** The Owner turns one helper on or off (C1's agents-switches contract). Answers what the API says the switch now is, or a closed word: `forbidden`, `locked` (409 not_switchable: no switch of its own), `down`. */
export type SwitchResult = { ok: true; data: AgentSwitch } | { ok: false; error: "forbidden" | "locked" | "down" };

export async function setAgentSwitchAction(tenantId: string, agent: unknown, enabled: unknown): Promise<SwitchResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !(AGENT_KEYS as readonly unknown[]).includes(agent) || typeof enabled !== "boolean") return { ok: false, error: "forbidden" };
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return { ok: false, error: "forbidden" };
    const data = await putAgentSwitch(user.accessToken, tenantId, agent as AgentKey, enabled);
    revalidatePath(`/app/tenants/${tenantId}/ai-team`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.status === 409) return { ok: false, error: "locked" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "down" };
  }
}
