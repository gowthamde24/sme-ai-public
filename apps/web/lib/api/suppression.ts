import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the suppression-key endpoints of OUR API (T010, ADR 0020; the K1 screen).
 *
 * The API sends counts and flags only, never a key, a hash, an address or a phone number. A body with any other field, a missing field or a count that is not a whole number is an error and
 * is never rendered, so a field added to the API later cannot reach the screen by accident.
 */
export type SuppressionStatus = {
  key_configured: boolean;
  key_version: number | null;
  unkeyed_contacts: number | null;
};
export type BackfillResult = {
  recorded: number;
  skipped: number;
  flagged: number;
  unkeyable: number;
  remaining: number;
};

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(what);
}
function onlyKeys(r: Rec, keys: readonly string[], what: string): void {
  const extra = Object.keys(r).filter((k) => !keys.includes(k));
  if (extra.length > 0 || keys.some((k) => !(k in r))) bad(what);
}
const count = (r: Rec, k: string): number => (typeof r[k] === "number" && Number.isSafeInteger(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : bad(k));
const countOrNull = (r: Rec, k: string): number | null => (r[k] === null ? null : count(r, k));
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k));

export function parseStatus(json: unknown): SuppressionStatus {
  if (!isRecord(json)) return bad("suppression status");
  onlyKeys(json, ["key_configured", "key_version", "unkeyed_contacts"], "suppression status");
  return { key_configured: bool(json, "key_configured"), key_version: countOrNull(json, "key_version"), unkeyed_contacts: countOrNull(json, "unkeyed_contacts") };
}

export function parseBackfill(json: unknown): BackfillResult {
  if (!isRecord(json)) return bad("backfill result");
  onlyKeys(json, ["recorded", "skipped", "flagged", "unkeyable", "remaining"], "backfill result");
  return { recorded: count(json, "recorded"), skipped: count(json, "skipped"), flagged: count(json, "flagged"), unkeyable: count(json, "unkeyable"), remaining: count(json, "remaining") };
}

/**
 * The one question the screen answers. `clear` is the ONLY state that reads as good, and only when the key is configured and the API says exactly zero contacts are unkeyed. A missing status
 * (an outage, an unreadable body) is `unavailable`, and an unknown count (null) is `unkeyed`: nothing unknown can read as clear.
 */
export type Readiness = "clear" | "unkeyed" | "no_key" | "unavailable";
export function suppressionReadiness(status: SuppressionStatus | null): Readiness {
  if (status === null) return "unavailable";
  if (!status.key_configured) return "no_key";
  if (status.unkeyed_contacts === 0) return "clear";
  return "unkeyed";
}

function checked(tenantId: string): void {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
}

/** Owner or Admin (the API decides). */
export async function fetchSuppressionStatus(accessToken: string, tenantId: string): Promise<SuppressionStatus> {
  checked(tenantId);
  return parseStatus(await apiRequest(`/v1/tenants/${tenantId}/suppression/status`, accessToken));
}

/** Owner with a second factor (the API decides). No body: the keys are computed on the server from what the caller may already read. Idempotent; call again while `remaining` is above zero. */
export async function runBackfill(accessToken: string, tenantId: string): Promise<BackfillResult> {
  checked(tenantId);
  return parseBackfill(await apiRequest(`/v1/tenants/${tenantId}/suppression/backfill`, accessToken, { method: "POST" }));
}
