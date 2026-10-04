import type {
  ErasureRequestOut,
  ErasureResultOut,
  PageErasureRequestOut,
} from "@contracts";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the erasure endpoints of OUR API (T006b, ADR 0014).
 *
 * A result holds counts per column and row ids for manual review, never a value. Types come from
 * packages/contracts/erasure.ts (generated); responses are validated, not trusted.
 */
export type {
  ErasureRequestOut,
  ErasureResultOut,
  PageErasureRequestOut,
} from "@contracts";

export type ErasureScope = ErasureRequestOut["scope"];
export type ErasureStatus = ErasureRequestOut["status"];

export const SCOPE_LABELS: Record<ErasureScope, string> = {
  contact: "One contact",
  company: "One company",
  tenant: "The whole workspace",
};

/** What a person sees. Nothing reads "Completed" unless the Owner ran it. */
export const STATUS_LABELS: Record<ErasureStatus, string> = {
  pending: "Waiting for the owner",
  executing: "Running",
  executed: "Completed",
  cancelled: "Cancelled",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an erasure response.`);
}
function str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : bad(key);
}
function strOrNull(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return v === null ? null : typeof v === "string" ? v : bad(key);
}
function num(v: unknown, key: string): number {
  return typeof v === "number" && Number.isFinite(v) ? v : bad(key);
}
function oneOf<T extends string>(
  r: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const v = r[key];
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : bad(key);
}

const SCOPES = ["contact", "company", "tenant"] as const;
const STATUSES = ["pending", "executing", "executed", "cancelled"] as const;

export function parseResult(json: unknown): ErasureResultOut {
  if (!isRecord(json)) return bad("result");
  if (!isRecord(json.counts) || !Array.isArray(json.review))
    return bad("result");
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(json.counts))
    counts[key] = num(value, "counts");
  const review = json.review.map((item: unknown) => {
    if (!isRecord(item)) return bad("review item");
    return {
      table: str(item, "table"),
      column: str(item, "column"),
      id: str(item, "id"),
    };
  });
  const status = json.status;
  if (status !== "executed" && status !== "dry_run") bad("status");
  return {
    request_id: str(json, "request_id"),
    scope: oneOf(json, "scope", SCOPES),
    status: status as "executed" | "dry_run",
    dry_run: json.dry_run === true,
    counts,
    review,
    review_truncated: json.review_truncated === true,
    exports_logged: num(json.exports_logged, "exports_logged"),
    note: str(json, "note"),
    replayed: json.replayed === true,
  };
}

export function parseRequest(json: unknown): ErasureRequestOut {
  if (!isRecord(json)) return bad("request");
  return {
    id: str(json, "id"),
    scope: oneOf(json, "scope", SCOPES),
    subject_id: strOrNull(json, "subject_id"),
    status: oneOf(json, "status", STATUSES),
    requested_by: str(json, "requested_by"),
    created_at: str(json, "created_at"),
    execute_after: str(json, "execute_after"),
    executed_by: strOrNull(json, "executed_by"),
    executed_at: strOrNull(json, "executed_at"),
    cancelled_by: strOrNull(json, "cancelled_by"),
    cancelled_at: strOrNull(json, "cancelled_at"),
    result:
      json.result === null || json.result === undefined
        ? null
        : parseResult(json.result),
  };
}

export function parseRequestPage(json: unknown): PageErasureRequestOut {
  if (!isRecord(json) || !Array.isArray(json.items)) return bad("page");
  const next = json.next_cursor;
  if (next !== null && typeof next !== "string") bad("cursor");
  return { items: json.items.map(parseRequest), next_cursor: next };
}

function checked(tenantId: string, ...ids: string[]): void {
  if (!isCanonicalUuid(tenantId) || ids.some((id) => !isCanonicalUuid(id)))
    throw new ApiContractError("id");
}

export async function fetchErasureRequests(
  accessToken: string,
  tenantId: string,
  limit = 20,
): Promise<PageErasureRequestOut> {
  checked(tenantId);
  return parseRequestPage(
    await apiRequest(
      `/v1/tenants/${tenantId}/erasure-requests?limit=${limit}`,
      accessToken,
    ),
  );
}

/** Idempotent on `id`: an identical retry answers 200 with the same request. */
export async function requestErasure(
  accessToken: string,
  tenantId: string,
  input: { id: string; scope: ErasureScope; subjectId: string | null },
): Promise<ErasureRequestOut> {
  checked(tenantId, input.id, ...(input.subjectId ? [input.subjectId] : []));
  if ((input.scope === "tenant") !== (input.subjectId === null))
    throw new ApiContractError("subject");
  return parseRequest(
    await apiRequest(`/v1/tenants/${tenantId}/erasure-requests`, accessToken, {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        scope: input.scope,
        ...(input.subjectId ? { subject_id: input.subjectId } : {}),
      }),
    }),
  );
}

/** `dryRun` previews the counts and the review list and changes nothing. */
export async function executeErasure(
  accessToken: string,
  tenantId: string,
  requestId: string,
  dryRun: boolean,
): Promise<ErasureResultOut> {
  checked(tenantId, requestId);
  return parseResult(
    await apiRequest(
      `/v1/tenants/${tenantId}/erasure-requests/${requestId}/execute`,
      accessToken,
      { method: "POST", body: JSON.stringify({ dry_run: dryRun }) },
    ),
  );
}

export async function cancelErasure(
  accessToken: string,
  tenantId: string,
  requestId: string,
): Promise<ErasureRequestOut> {
  checked(tenantId, requestId);
  return parseRequest(
    await apiRequest(
      `/v1/tenants/${tenantId}/erasure-requests/${requestId}/cancel`,
      accessToken,
      { method: "POST" },
    ),
  );
}
