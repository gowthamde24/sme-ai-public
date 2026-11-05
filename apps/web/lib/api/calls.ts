import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Two calls of C1's Calls API (docs/contracts/calls.md; services/ai-api/app/telephony/routes.py), with the signed-in person's own token:
 *
 *   GET  /v1/tenants/{t}/calls/{id}          Owner, Admin, Sales: the call (who, the lead it belongs to, its short summary); the transcript is not read here
 *   POST /v1/tenants/{t}/calls/{id}/handled  Owner, Admin, Sales: a caller asked for a person and the team called back; the call leaves Today's "Needs you" (once; 404 for another workspace's call)
 */
const path = (tenantId: string, callId: string): string => {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(callId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/calls/${callId}`;
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const shortText = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : null);

/** What the "asked for a person" card needs of a call: the lead to call back from (null: the call has none) and the call's own short summary (English, the API's; shown in English only). */
export type CallBrief = { leadId: string | null; gist: string | null };

export async function getCallBrief(token: string, tenantId: string, callId: string): Promise<CallBrief> {
  const json = await apiRequest(path(tenantId, callId), token);
  if (!isRecord(json) || json.id !== callId) throw new ApiContractError("Unexpected call body.");
  return { leadId: typeof json.lead_id === "string" && isCanonicalUuid(json.lead_id) ? json.lead_id : null, gist: shortText(json.summary_short, 300) };
}

export async function markCallHandled(token: string, tenantId: string, callId: string): Promise<void> {
  await apiRequest(`${path(tenantId, callId)}/handled`, token, { method: "POST" });
}
