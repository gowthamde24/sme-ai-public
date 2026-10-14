import { ApiAuthError, ApiRequestError, apiRequest } from "./client";

/**
 * "Try with example data" (job CL, blueprint 3.2): one tap loads a clearly labelled sample workspace for the business type, a button removes it. The contract is a guess at what job CK builds:
 *   POST   /v1/tenants/{id}/example-data   -> 200/201   (Owner/Admin; safe to repeat: one sample set)
 *   DELETE /v1/tenants/{id}/example-data   -> 200/204   (removes only the rows the sample made)
 * Whether it can be done at all is the `example_data` part of `GET .../pack` (lib/api/pack.ts): the web offers the button only when the server says `available`. A route that does not exist answers 404/501 and the
 * result is `unavailable`. Server side only.
 */
export type ExampleResult = "ok" | "unavailable" | "refused" | "failed";

async function call(accessToken: string, tenantId: string, method: "POST" | "DELETE"): Promise<ExampleResult> {
  try {
    await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/example-data`, accessToken, { method });
    return "ok";
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) return error.status === 404 || error.status === 501 ? "unavailable" : error.status === 403 || error.status === 409 ? "refused" : "failed";
    return "failed";
  }
}
export const loadExampleData = (accessToken: string, tenantId: string) => call(accessToken, tenantId, "POST");
export const removeExampleData = (accessToken: string, tenantId: string) => call(accessToken, tenantId, "DELETE");
