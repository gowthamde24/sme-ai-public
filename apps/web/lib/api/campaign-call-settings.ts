import { parseCallSettings, type CallSettings } from "@/lib/call-settings/types";
import { OVERRIDABLE, type CampaignOverride, type OverridableField } from "@/lib/call-settings/campaign";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * A campaign's call settings from C1's API (job DQ part 3; contract-call-settings.md, "Per campaign"): `GET /v1/tenants/{id}/call-settings/campaigns/{campaign_id}` (Owner, Admin), `PUT` the override (Owner, second factor; `{}`
 * removes it) and `POST .../clear`. The answer is `CampaignCallSettingsOut`: `effective.settings` is what a dialer applies, `effective.overridden` names the fields the campaign changed. SERVER ONLY, the person's own token.
 */
const path = (tenantId: string, campaignId: string): string => {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(campaignId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/call-settings/campaigns/${campaignId}`;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type CampaignCallsRead = { effective: CallSettings; overridden: OverridableField[]; saved: boolean };

export function parseCampaignCalls(json: unknown): CampaignCallsRead {
  const eff = isRecord(json) && isRecord(json.effective) ? json.effective : null;
  const settings = eff ? parseCallSettings(eff.settings) : null;
  if (!eff || !settings || !Array.isArray(eff.overridden)) throw new ApiContractError("Unexpected campaign call settings response.");
  const overridden = eff.overridden.filter((f): f is OverridableField => typeof f === "string" && (OVERRIDABLE as readonly string[]).includes(f));
  return { effective: settings, overridden, saved: isRecord(json) && json.saved === true };
}

export async function getCampaignCalls(token: string, tenantId: string, campaignId: string): Promise<CampaignCallsRead> {
  return parseCampaignCalls(await apiRequest(path(tenantId, campaignId), token));
}
export async function putCampaignOverride(token: string, tenantId: string, campaignId: string, override: CampaignOverride): Promise<void> {
  await apiRequest(path(tenantId, campaignId), token, { method: "PUT", body: JSON.stringify(override) });
}
export async function clearCampaignOverride(token: string, tenantId: string, campaignId: string): Promise<void> {
  await apiRequest(`${path(tenantId, campaignId)}/clear`, token, { method: "POST", body: JSON.stringify({}) });
}
