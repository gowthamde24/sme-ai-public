import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * C1's simulated live call for the demo workspace (docs/contracts/calls.md, "Start demo"): `POST /v1/tenants/{id}/calls/demo/start` (Owner or Admin, a DEMO workspace only; any other 404) makes a labelled simulated call (`simulated: true`) that is live for about ten minutes and shows in
 * `GET /calls?state=live`; `POST .../calls/demo/end` ends it. Nothing is called, nothing costs money.
 */
export async function startDemoCall(accessToken: string, tenantId: string): Promise<{ callId: string }> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  const json = await apiRequest(`/v1/tenants/${tenantId}/calls/demo/start`, accessToken, { method: "POST", body: JSON.stringify({}) });
  const id = typeof json === "object" && json !== null ? (json as { call_id?: unknown }).call_id : null;
  if (typeof id !== "string" || id === "") throw new ApiContractError("Unexpected demo call response.");
  return { callId: id };
}

export async function endDemoCall(accessToken: string, tenantId: string): Promise<void> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  await apiRequest(`/v1/tenants/${tenantId}/calls/demo/end`, accessToken, { method: "POST", body: JSON.stringify({}) });
}
