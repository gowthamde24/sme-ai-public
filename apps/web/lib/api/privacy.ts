import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, iso, list, oneOf, optInt, optIso, optStr, rec, str, uuid, word } from "./shape";

/**
 * Settings > Privacy, the person's own rights (job CC, screen 2; ADR 0075, the contract is in job BN's report): download my data, delete my account, delete my workspace. Server side only, with the person's own token.
 * The ids a request carries (`export_id`, `request_id`) are uuids the screen makes: sending the same one again is a safe retry. A signed link to a file is a bearer URL that works for five minutes: it is passed to the
 * page that asked and never stored, logged or revalidated into any page.
 */
export const EXPORT_STATUSES = ["queued", "running", "ready", "failed", "expired"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export const EXPORT_ERRORS = ["too_large", "source_unreadable", "storage", "internal"] as const;
export const DELETION_STATUSES = ["scheduled", "cancelled", "executed", "blocked"] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export interface DataExport {
  id: string;
  scope: "person" | "workspace";
  status: ExportStatus;
  requested_at: string;
  ready_at: string | null;
  expires_at: string | null;
  size_bytes: number | null;
  error_code: string | null;
}
export interface Deletion {
  id: string;
  kind: "account" | "workspace";
  status: DeletionStatus;
  requested_at: string;
  execute_after: string;
  cancelled_at: string | null;
  executed_at: string | null;
  blocked_reason: string | null;
}
export interface ExportLink {
  url: string;
  link_valid_seconds: number;
  file_expires_at: string | null;
  size_bytes: number | null;
}

export function parseExport(json: unknown): DataExport {
  const x = rec(json, "export");
  return {
    id: uuid(x.id, "id"),
    scope: oneOf(x.scope, ["person", "workspace"] as const, "scope"),
    status: oneOf(x.status, EXPORT_STATUSES, "status"),
    requested_at: iso(x.requested_at, "requested_at"),
    ready_at: optIso(x.ready_at, "ready_at"),
    expires_at: optIso(x.expires_at, "expires_at"),
    size_bytes: optInt(x.size_bytes, "size_bytes"),
    error_code: x.error_code === null || x.error_code === undefined ? null : word(x.error_code, "error_code"),
  };
}
export const parseExports = (json: unknown): DataExport[] => list(rec(json, "exports").exports, "exports", 100).map(parseExport);
export const parseOneExport = (json: unknown): DataExport => parseExport(rec(json, "export").export);

export function parseDeletion(json: unknown): Deletion {
  const x = rec(json, "deletion");
  return {
    id: uuid(x.id, "id"),
    kind: oneOf(x.kind, ["account", "workspace"] as const, "kind"),
    status: oneOf(x.status, DELETION_STATUSES, "status"),
    requested_at: iso(x.requested_at, "requested_at"),
    execute_after: iso(x.execute_after, "execute_after"),
    cancelled_at: optIso(x.cancelled_at, "cancelled_at"),
    executed_at: optIso(x.executed_at, "executed_at"),
    blocked_reason: x.blocked_reason === null || x.blocked_reason === undefined ? null : word(x.blocked_reason, "blocked_reason"),
  };
}
export const parseDeletions = (json: unknown): Deletion[] => list(rec(json, "deletions").deletions, "deletions", 100).map(parseDeletion);
export const parseOneDeletion = (json: unknown): Deletion => parseDeletion(rec(json, "deletion").deletion);

const SIGNED = /^https?:\/\/[^\s]{10,2000}$/;
export function parseExportLink(json: unknown): ExportLink {
  const x = rec(json, "link");
  const url = str(x.url, "url", 2100);
  if (!SIGNED.test(url)) bad("link");
  return { url, link_valid_seconds: int(x.link_valid_seconds, "link_valid_seconds", 1, 86_400), file_expires_at: optIso(x.file_expires_at, "file_expires_at"), size_bytes: optInt(x.size_bytes, "size_bytes") };
}

const ids = (tenantId: string | null, ...more: string[]): void => {
  if (tenantId !== null && !isCanonicalUuid(tenantId)) bad("workspace id");
  for (const id of more) if (!isCanonicalUuid(id)) bad("id");
};
const post = (path: string, token: string, body?: unknown) => apiRequest(path, token, { method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

// ----- my data
export async function listMyExports(token: string): Promise<DataExport[]> {
  return parseExports(await apiRequest("/v1/me/data-exports", token));
}
export async function getMyExport(token: string, exportId: string): Promise<DataExport> {
  ids(null, exportId);
  return parseOneExport(await apiRequest(`/v1/me/data-exports/${exportId}`, token));
}
/** Person scope: any member. Workspace scope (`tenantId` given): the Owner, with the second factor. */
export async function requestExport(token: string, exportId: string, tenantId: string | null): Promise<DataExport> {
  ids(tenantId, exportId);
  return parseOneExport(await post(tenantId ? `/v1/tenants/${tenantId}/data-exports` : "/v1/me/data-exports", token, { export_id: exportId }));
}
export async function exportLink(token: string, exportId: string): Promise<ExportLink> {
  ids(null, exportId);
  return parseExportLink(await post(`/v1/me/data-exports/${exportId}/link`, token));
}

// ----- delete my account / my workspace
export async function listMyDeletions(token: string): Promise<Deletion[]> {
  return parseDeletions(await apiRequest("/v1/me/deletion-requests", token));
}
export async function listWorkspaceDeletions(token: string, tenantId: string): Promise<Deletion[]> {
  ids(tenantId);
  return parseDeletions(await apiRequest(`/v1/tenants/${tenantId}/deletion-requests`, token));
}
export async function requestAccountDeletion(token: string, requestId: string, confirmEmail: string): Promise<Deletion> {
  ids(null, requestId);
  return parseOneDeletion(await post("/v1/me/deletion-requests", token, { request_id: requestId, confirm_email: confirmEmail }));
}
export async function cancelAccountDeletion(token: string, requestId: string): Promise<Deletion> {
  ids(null, requestId);
  return parseOneDeletion(await post(`/v1/me/deletion-requests/${requestId}/cancel`, token));
}
export async function requestWorkspaceDeletion(token: string, tenantId: string, requestId: string, confirmName: string): Promise<Deletion> {
  ids(tenantId, requestId);
  return parseOneDeletion(await post(`/v1/tenants/${tenantId}/deletion-requests`, token, { request_id: requestId, confirm_name: confirmName }));
}
export async function cancelWorkspaceDeletion(token: string, tenantId: string, requestId: string): Promise<Deletion> {
  ids(tenantId, requestId);
  return parseOneDeletion(await post(`/v1/tenants/${tenantId}/deletion-requests/${requestId}/cancel`, token));
}
/** After the cooling-off. The Owner, with the second factor. The API runs the erasure and answers the deletion with its counts; only the deletion is kept here (counts are the erasure page's business). */
export async function executeWorkspaceDeletion(token: string, tenantId: string, requestId: string): Promise<Deletion> {
  ids(tenantId, requestId);
  return parseOneDeletion(await post(`/v1/tenants/${tenantId}/deletion-requests/${requestId}/execute`, token));
}

export { optStr, bool };
