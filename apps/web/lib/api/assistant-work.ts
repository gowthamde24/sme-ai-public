import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { DESTINATIONS, LIVE_TESTS, parseActivity, parseActivityEntry, parseImportDraft, parsePlan, parseTestResult, parseUploadedFile, type ActivityEntry, type ConsentSource, type Destination, type ImportCounts, type ImportDraft, type LiveTest, type TestResult, type UploadedFile, type WorkPlan } from "@/lib/assistant-work/types";

/**
 * The assistant does the work: the API calls behind the chat's work cards and Settings > Activity, with the signed-in person's own token (SERVER ONLY: the routes and pages call these).
 * C1's contract, docs/contracts/assistant-tools.md, under `/v1/tenants/{id}/assistant`:
 *   POST /files                         {name, content_type, size_bytes, data_base64}       -> 201 {file_id, name, size_bytes, kind, expires_at}   (413 file_too_large, 415 file_type, 422 file_empty)
 *   POST /plans/{plan_id}/decide        {decision: "do" | "cancel", confirmed}              -> the plan                                            (409 confirm_needed / plan_state / plan_expired, 403 mfa_required)
 *   POST /plans/{plan_id}/undo          {}                                                  -> the plan                                            (409 nothing_to_undo / plan_state, 403)
 *   POST /secrets/{request_id}          {value}                                             -> {saved: true, last4: "1a2b" | null}                 (Owner only)
 *   POST /setups/{setup_id}/test        {test}                                              -> {ok, reason, detail, at}
 *   GET  /actions?since&before&limit=50                                                     -> {items: [...], next_before}                         (Owner, Admin)
 *   POST /actions/{action_id}/undo      {}                                                  -> the entry
 * A refusal is an ApiRequestError; an answer that is not the shape is an ApiContractError.
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

export async function listAssistantActions(token: string, tenantId: string, since: string, before?: string | null): Promise<{ items: ActivityEntry[]; nextBefore: string | null }> {
  const q = new URLSearchParams({ since, ...(before ? { before } : {}), limit: "50" });
  return need(parseActivity(await apiRequest(`${base(tenantId)}/actions?${q.toString()}`, token)), "action list");
}

export async function undoAssistantAction(token: string, tenantId: string, actionId: string): Promise<ActivityEntry> {
  return need(parseActivityEntry(await apiRequest(`${base(tenantId)}/actions/${uuid(actionId)}/undo`, token, { method: "POST", body: JSON.stringify({}) })), "action");
}

// ---- the editable import (contract docs/contracts/file-import.md, section 4) -------------------------------------------
//   GET    /imports/{import_id}?cursor=             -> the card (state and rows now)                    (404 gone)
//   PATCH  /imports/{import_id}/rows                {edits:[{row_id, cell, value}], include:[{row_id, include}]} -> {counts}   (409 import_state, 422 validation_error)
//   POST   /imports/{import_id}/confirm             {consent_source?, exclude_row_ids?}                 -> the plan                (409 import_state, 422 consent_source_required)
//   POST   /imports/{import_id}/cancel              -> 200 {state:"cancelled"}: cancels and deletes the rows and the original at once (the API has no HTTP DELETE anywhere: C1, 14 Nov)
//   PATCH  /imports/{import_id}                     {destination: leads|catalogue|prices} -> the whole card re-mapped
//   confirm errors: 422 `not_yet` (new catalogue items cannot be added from a file yet: choose Prices), 422 `nothing_to_add`

export async function getImport(token: string, tenantId: string, importId: string, cursor: string | null): Promise<ImportDraft> {
  const q = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : "";
  return need(parseImportDraft(await apiRequest(`${base(tenantId)}/imports/${uuid(importId)}${q}`, token)), "import");
}

export async function patchImportRows(token: string, tenantId: string, importId: string, change: { edits: { rowId: string; cell: string; value: string }[]; include: { rowId: string; include: boolean }[] }): Promise<ImportCounts> {
  const json = await apiRequest(`${base(tenantId)}/imports/${uuid(importId)}/rows`, token, { method: "PATCH", body: JSON.stringify({ edits: change.edits.map((e) => ({ row_id: e.rowId, cell: e.cell, value: e.value })), include: change.include.map((i) => ({ row_id: i.rowId, include: i.include })) }) });
  const c = typeof json === "object" && json !== null && typeof (json as Record<string, unknown>).counts === "object" ? ((json as Record<string, unknown>).counts as Record<string, unknown> | null) : null;
  if (!c) throw new ApiContractError("Unexpected import counts.");
  const n = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  return { rows: n(c.rows), new: n(c.new), existing: n(c.existing), invalidPhone: n(c.invalid_phone), unsure: n(c.unsure) };
}

export async function confirmImport(token: string, tenantId: string, importId: string, consentSource: ConsentSource | null, excludeRowIds: readonly string[]): Promise<WorkPlan> {
  const json = await apiRequest(`${base(tenantId)}/imports/${uuid(importId)}/confirm`, token, { method: "POST", body: JSON.stringify({ ...(consentSource ? { consent_source: consentSource } : {}), ...(excludeRowIds.length > 0 ? { exclude_row_ids: excludeRowIds.slice(0, 5000) } : {}) }) }); // no empty list: nothing is excluded by saying nothing
  const inner = typeof json === "object" && json !== null && "plan" in json ? (json as Record<string, unknown>).plan : json;
  return need(parsePlan(inner), "plan");
}

export async function cancelImport(token: string, tenantId: string, importId: string): Promise<void> {
  await apiRequest(`${base(tenantId)}/imports/${uuid(importId)}/cancel`, token, { method: "POST", body: JSON.stringify({}) });
}

/** Send the import somewhere else: `PATCH /imports/{id}` `{destination}` -> 200 the whole card, re-mapped (409 `import_state` once it is no longer ready). */
export async function setImportDestination(token: string, tenantId: string, importId: string, destination: Destination): Promise<ImportDraft> {
  if (!(DESTINATIONS as readonly string[]).includes(destination)) throw new ApiContractError("destination");
  return need(parseImportDraft(await apiRequest(`${base(tenantId)}/imports/${uuid(importId)}`, token, { method: "PATCH", body: JSON.stringify({ destination }) })), "import");
}
