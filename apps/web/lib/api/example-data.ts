import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";

/**
 * "Try with example data" (job CL, blueprint 3.2, on top of job CK): one tap loads a clearly labelled sample (names start "Example:", no phone, no e-mail: nothing can ever be sent to it); a button takes it away.
 *   GET  /v1/tenants/{id}/example-data          every member: { loaded, batch_id, pack_id, loaded_at, removed_at, counts }
 *   POST /v1/tenants/{id}/example-data          Owner/Admin: load the sample (409 `example_data_loaded` when it already is)
 *   POST /v1/tenants/{id}/example-data/remove   Owner/Admin: remove the sample rows that are untouched and unused; the others are KEPT and counted (a POST: the API has no DELETE)
 * Server side only.
 */
export type ExampleCounts = { companies: number; contacts: number; leads: number; products: number; /** Enquiries, requirements, knowledge, lead arrivals and profiles an operator marked as example (job test-workspaces); 0 from an older API. */ other: number };
export type ExampleStatus = { loaded: boolean; counts: ExampleCounts };
export type ExampleRemoved = { removed: ExampleCounts; kept: ExampleCounts };
export type ExampleResult = "ok" | "unavailable" | "refused" | "failed";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in an example data response.`);
};
const KEYS = ["companies", "contacts", "leads", "products"] as const;

function parseCounts(v: unknown): ExampleCounts {
  if (!isRecord(v)) return bad("counts");
  const out = { companies: 0, contacts: 0, leads: 0, products: 0, other: 0 };
  for (const k of KEYS) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > 100_000) return bad("count");
    out[k] = n;
  }
  if (v.other !== undefined) {
    if (typeof v.other !== "number" || !Number.isSafeInteger(v.other) || v.other < 0 || v.other > 100_000) return bad("count");
    out.other = v.other;
  }
  return out;
}

export function parseStatus(json: unknown): ExampleStatus {
  if (!isRecord(json) || typeof json.loaded !== "boolean") return bad("status");
  return { loaded: json.loaded, counts: parseCounts(json.counts) };
}
export function parseRemoved(json: unknown): ExampleRemoved {
  if (!isRecord(json)) return bad("body");
  return { removed: parseCounts(json.removed), kept: parseCounts(json.kept) };
}

const noRoute = (e: unknown) => e instanceof ApiRequestError && (e.status === 404 || e.status === 501 || (e.status === 503 && e.code === "packs_unavailable"));

/** Is the sample loaded? Null when this server cannot say (no route, or a failure): the banner is then not drawn, never guessed. */
export async function getExampleStatus(accessToken: string, tenantId: string): Promise<ExampleStatus | null> {
  try {
    return parseStatus(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/example-data`, accessToken));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

async function call(accessToken: string, tenantId: string, path: "" | "/remove"): Promise<{ result: ExampleResult; removed?: ExampleRemoved }> {
  try {
    const json = await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/example-data${path}`, accessToken, { method: "POST" });
    return path === "/remove" ? { result: "ok", removed: parseRemoved(json) } : { result: "ok" };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (noRoute(error)) return { result: "unavailable" };
    if (error instanceof ApiRequestError) return { result: error.status === 403 || error.status === 409 ? "refused" : "failed" };
    return { result: "failed" };
  }
}
/** How many rows of a count, all kinds together. */
export const countAll = (c: ExampleCounts | undefined): number => (c ? c.companies + c.contacts + c.leads + c.products + c.other : 0);

/**
 * "Remove and load it again" in ONE step: POST /example-data/reset (one transaction; changed or used rows are kept and counted). An API without that route (older) gets the two calls instead:
 * remove, then load; a failed removal loads nothing.
 */
export async function resetExampleData(accessToken: string, tenantId: string): Promise<{ result: ExampleResult; kept: number }> {
  try {
    const json = await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/example-data/reset`, accessToken, { method: "POST" });
    return { result: "ok", kept: countAll(parseRemoved(json).kept) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (!(error instanceof ApiRequestError && (error.status === 404 || error.status === 405 || error.status === 501))) {
      if (noRoute(error)) return { result: "unavailable", kept: 0 };
      if (error instanceof ApiRequestError) return { result: error.status === 403 || error.status === 409 ? "refused" : "failed", kept: 0 };
      return { result: "failed", kept: 0 };
    }
  }
  const removed = await call(accessToken, tenantId, "/remove");
  if (removed.result !== "ok") return { result: removed.result, kept: 0 };
  return { result: (await call(accessToken, tenantId, "")).result, kept: countAll(removed.removed?.kept) };
}

export const loadExampleData = async (accessToken: string, tenantId: string): Promise<ExampleResult> => (await call(accessToken, tenantId, "")).result;
export const removeExampleData = (accessToken: string, tenantId: string) => call(accessToken, tenantId, "/remove");
