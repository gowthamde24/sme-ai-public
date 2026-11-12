import { parseHowSpeaks, speaksToApi, type HowSpeaks, type SpeaksChange } from "@/lib/talk-training/speaks";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * C1's "How your assistant speaks" (docs/contracts/how-assistant-speaks.md, fixed, PR #459; the endpoint is on staging since #463, used with SPEAKS_PANEL_SCREENS=1): `GET` (Owner and Admin; Sales and Viewer get 403, so the panel is not shown to them) and `PUT` (Owner, second factor: 403 mfa_required; any subset; null resets;
 * 422 validation_error with fields). The answer of both is the same object. An answer that does not fit is a contract error, never a guess.
 */
const path = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}/how-assistant-speaks`;
};
const must = (v: HowSpeaks | null): HowSpeaks => {
  if (v === null) throw new ApiContractError("Unexpected how-assistant-speaks body.");
  return v;
};
export const getHowSpeaks = async (token: string, tenantId: string): Promise<HowSpeaks> => must(parseHowSpeaks(await apiRequest(path(tenantId), token)));
export const putHowSpeaks = async (token: string, tenantId: string, change: SpeaksChange): Promise<HowSpeaks> => {
  const body = speaksToApi(change);
  if (Object.keys(body).length === 0) throw new ApiContractError("Unexpected empty change.");
  return must(parseHowSpeaks(await apiRequest(path(tenantId), token, { method: "PUT", body: JSON.stringify(body) })));
};
