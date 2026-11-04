import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { LIVE_TESTS, parseActivity, parseActivityEntry, parsePlan, parseTestResult, parseUploadedFile, type ActivityEntry, type LiveTest, type TestResult, type UploadedFile, type WorkPlan } from "@/lib/assistant-work/types";

/**
 * The assistant does the work: the API calls behind the chat's work cards and Settings > Activity, with the signed-in person's own token (SERVER ONLY: the routes and pages call these).
 * ASSUMED until docs/contracts/assistant-tools.md, under `/v1/tenants/{id}/assistant`:
 *   POST /files                         {name, content_type, size_bytes, data_base64}       -> {file_id, name, size_bytes, kind, expires_at}
 *   POST /plans/{plan_id}/decide        {decision: "do" | "cancel", confirmed}              -> the plan
 *   POST /plans/{plan_id}/undo          {}                                                  -> the plan
 *   POST /secrets/{request_id}          {value}                                             -> {saved: true, last4?}
 *   POST /setups/{setup_id}/test        {test}                                              -> {ok, reason, detail, at}
 *   GET  /actions?since&limit=50                                                            -> {items: [...], next_before}
 *   POST /actions/{action_id}/undo      {}                                                  -> the entry
 * A refusal is an ApiRequestError (403 `mfa_required`, 403 forbidden, 409 `plan_expired` / `plan_state` / `undo_expired`, 422 `secret_rejected`); an answer that is not the shape is an ApiContractError.
 */
const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/assistant`;
};
const need = <T>(v: T | null, what: string): T => {
  if (v === null) throw new ApiContractError(`Unexpected ${what} from the assistant's work API.`);
  return v;
};
const uuid = (id: string): string => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("id");
  return id;
};

export async function uploadAssistantFile(token: string, tenantId: string, file: { name: string; contentType: string; bytes: ArrayBuffer }): Promise<UploadedFile> {
  const json = await apiRequest(`${base(tenantId)}/files`, token, { method: "POST", body: JSON.stringify({ name: file.name, content_type: file.contentType, size_bytes: file.bytes.byteLength, data_base64: Buffer.from(file.bytes).toString("base64") }) });
  return need(parseUploadedFile(json), "file");
}

export async function decidePlan(token: string, tenantId: string, planId: string, decision: "do" | "cancel", confirmed: boolean): Promise<WorkPlan> {
  return need(parsePlan(await apiRequest(`${base(tenantId)}/plans/${uuid(planId)}/decide`, token, { method: "POST", body: JSON.stringify({ decision, confirmed }) })), "plan");
}

export async function undoPlan(token: string, tenantId: string, planId: string): Promise<WorkPlan> {
  return need(parsePlan(await apiRequest(`${base(tenantId)}/plans/${uuid(planId)}/undo`, token, { method: "POST", body: JSON.stringify({}) })), "plan");
}

/** The value goes into this one request body and nowhere else (not logged, not kept). Only the last four characters come back, if the API returns them. */
export async function saveAssistantSecret(token: string, tenantId: string, requestId: string, value: string): Promise<{ last4: string | null }> {
  const json = await apiRequest(`${base(tenantId)}/secrets/${uuid(requestId)}`, token, { method: "POST", body: JSON.stringify({ value }) });
  const r = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null;
  if (r?.saved !== true) throw new ApiContractError("Unexpected secret answer.");
  return { last4: typeof r.last4 === "string" && /^[\w-]{4}$/.test(r.last4) ? r.last4 : null };
}

export async function runSetupTest(token: string, tenantId: string, setupId: string, test: LiveTest): Promise<TestResult> {
  if (!(LIVE_TESTS as readonly string[]).includes(test)) throw new ApiContractError("test");
  return need(parseTestResult(await apiRequest(`${base(tenantId)}/setups/${uuid(setupId)}/test`, token, { method: "POST", body: JSON.stringify({ test }) })), "test result");
}

export async function listAssistantActions(token: string, tenantId: string, since: string): Promise<{ items: ActivityEntry[]; nextBefore: string | null }> {
  const q = new URLSearchParams({ since, limit: "50" });
  return need(parseActivity(await apiRequest(`${base(tenantId)}/actions?${q.toString()}`, token)), "action list");
}

export async function undoAssistantAction(token: string, tenantId: string, actionId: string): Promise<ActivityEntry> {
  return need(parseActivityEntry(await apiRequest(`${base(tenantId)}/actions/${uuid(actionId)}/undo`, token, { method: "POST", body: JSON.stringify({}) })), "action");
}
