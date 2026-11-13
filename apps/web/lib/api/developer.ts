import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, int, list, oneOf, optIso, optStr, rec, str, uuid, iso } from "./shape";

/**
 * Settings > Developer API keys (docs/contracts/developer-api.md section 2, ADR 0121), TEST MODE only: the keys of a workspace (never a secret or its hash), making one, rotating one, revoking one, and the test usage. Owner and Admin (the API decides, and asks for the second factor on changes).
 * The SECRET of a new or rotated key is in that one answer only: it is parsed into the value the action returns and nowhere else, never stored, logged or put in an address; a failed parse names the field, never the value. SERVER ONLY, with the person's own token.
 */
export const KEY_SCOPES = ["leads:write", "leads:read", "calls:read", "campaigns:write", "webhooks", "usage:read"] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];
export const MAX_ACTIVE_KEYS = 10;

export interface DevKey {
  id: string;
  name: string;
  mode: "test";
  /** "sk_test_ab12": the start of the key, safe to show. */
  prefix: string;
  last4: string;
  scopes: KeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  /** When its secret was last replaced (null if never). */
  rotatedAt: string | null;
  /** The list also returns revoked keys: `revokedAt` is set on those (they do not count against the ten active keys). */
  revokedAt: string | null;
  ipAllow: string[];
}
export interface Usage {
  today: { requests: number; leads: number; callsSimulated: number };
  month: { requests: number; leads: number; callsSimulated: number };
}
export type NewKey = { key: DevKey; secret: string };
export type KeyInput = { name: string; scopes: KeyScope[]; ipAllow: string[] };

export function parseKey(json: unknown): DevKey {
  const r = rec(json, "key");
  return {
    id: uuid(r.id, "key id"),
    name: str(r.name, "key name", 200),
    mode: oneOf(r.mode, ["test"] as const, "key mode"),
    prefix: str(r.prefix, "key prefix", 40),
    last4: str(r.last4, "key last4", 8),
    scopes: list(r.scopes, "key scopes", 20).map((s) => oneOf(s, KEY_SCOPES, "key scope")),
    createdAt: iso(r.created_at, "created_at"),
    lastUsedAt: optIso(r.last_used_at, "last_used_at"),
    rotatedAt: optIso(r.rotated_at, "rotated_at"),
    revokedAt: optIso(r.revoked_at, "revoked_at"),
    ipAllow: Array.isArray(r.ip_allow) ? list(r.ip_allow, "ip_allow", 50).map((i) => str(i, "ip", 60)) : [],
  };
}
export const parseKeys = (json: unknown): DevKey[] => list(rec(json, "keys").items, "keys", 200).map(parseKey);
export function parseNewKey(json: unknown): NewKey {
  const r = rec(json, "new key");
  const secret = str(r.secret, "secret", 200);
  if (!/^sk_test_[A-Za-z0-9_-]{16,100}$/.test(secret)) bad("secret");
  return { key: parseKey(r.key), secret };
}
function counts(json: unknown, what: string): Usage["today"] {
  const r = rec(json, what);
  return { requests: int(r.requests, `${what} requests`), leads: int(r.leads, `${what} leads`), callsSimulated: int(r.calls_simulated ?? 0, `${what} calls`) };
}
export function parseUsage(json: unknown): Usage {
  const r = rec(json, "usage");
  if (r.mode !== undefined && optStr(r.mode, "mode", 10) !== "test") bad("usage mode");
  return { today: counts(r.today, "today"), month: counts(r.month, "month") };
}

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) bad("workspace id");
  return `/v1/tenants/${tenantId}/developer`;
};
const keyPath = (tenantId: string, id: string, tail: string): string => {
  if (!isCanonicalUuid(id)) bad("key id");
  return `${base(tenantId)}/keys/${id}/${tail}`;
};
const post = (path: string, token: string, body: unknown = {}): Promise<unknown> => apiRequest(path, token, { method: "POST", body: JSON.stringify(body) });

export async function listKeys(token: string, tenantId: string): Promise<DevKey[]> {
  return parseKeys(await apiRequest(`${base(tenantId)}/keys`, token));
}
/** Always `mode: "test"`: a live key does not exist (the API answers 422 live_not_available). */
export async function createKey(token: string, tenantId: string, input: KeyInput): Promise<NewKey> {
  return parseNewKey(await post(`${base(tenantId)}/keys`, token, { name: input.name, scopes: input.scopes, ip_allow: input.ipAllow, mode: "test" }));
}
export async function rotateKey(token: string, tenantId: string, id: string): Promise<NewKey> {
  return parseNewKey(await post(keyPath(tenantId, id, "rotate"), token));
}
export async function revokeKey(token: string, tenantId: string, id: string): Promise<DevKey> {
  return parseKey(rec(await post(keyPath(tenantId, id, "revoke"), token), "revoked").key);
}
export async function getUsage(token: string, tenantId: string): Promise<Usage> {
  return parseUsage(await apiRequest(`${base(tenantId)}/usage`, token));
}
