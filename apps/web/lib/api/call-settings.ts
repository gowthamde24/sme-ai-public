import { parseCallSettings, purposesFor, type CallSettings, type CallSettingsRead, type Purpose, PURPOSES } from "@/lib/call-settings/types";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Call settings from C1's API (job DP; contract-call-settings.md): `GET /v1/tenants/{id}/call-settings` (Owner, Admin) and `PUT` (Owner, with the second factor; 403 `mfa_required`, 403 `workspace_read_only`, 422 for a value out of
 * range, 422 `locked_for_business_type`). The answer is `CallSettingsOut`: the settings and what the business type may not switch on. SERVER ONLY, with the person's own token; every answer is checked.
 */
const path = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/call-settings`;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseCallSettingsOut(json: unknown, modules: readonly string[] | null = null): CallSettingsRead {
  const settings = isRecord(json) ? parseCallSettings(json.settings) : null;
  if (!settings) throw new ApiContractError("Unexpected call settings response.");
  const locked = isRecord(json) && isRecord(json.locked) && Array.isArray(json.locked.allowed_purposes) ? json.locked.allowed_purposes.filter((p): p is Purpose => (PURPOSES as readonly unknown[]).includes(p)) : null;
  return { settings, saved: isRecord(json) && json.saved === true, lockedPurposes: locked ?? purposesFor(modules) };
}

export async function getCallSettings(token: string, tenantId: string, modules: readonly string[] | null = null): Promise<CallSettingsRead> {
  return parseCallSettingsOut(await apiRequest(path(tenantId), token), modules);
}
export async function putCallSettings(token: string, tenantId: string, settings: CallSettings): Promise<void> {
  await apiRequest(path(tenantId), token, { method: "PUT", body: JSON.stringify(settings) });
}
