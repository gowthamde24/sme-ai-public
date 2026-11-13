import { randomBytes, randomUUID } from "node:crypto";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { createKey, getUsage, listKeys, MAX_ACTIVE_KEYS, parseKey, revokeKey, rotateKey, type DevKey, type KeyInput, type NewKey, type Usage } from "@/lib/api/developer";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readJar, writeJar } from "@/lib/mock/jar";
import { developerKeysScreens } from "@/lib/screens/flag";

/**
 * Where Settings > Developer API keys gets and changes things (TEST mode only). `1` = C1's routes; `mock` = a few keys in ONE small cookie of the browser (checked by parseKey on every read; no key made here works anywhere, and the SECRET is made on the server, handed to the page once and
 * never stored: the cookie keeps only the prefix and the last four); off = the card says "coming soon". A failed read is null; a rejected session is thrown. SERVER ONLY.
 */
export const COOKIE = "sme_developer_keys_mock";
export type DeveloperRead = { mode: "off" } | { mode: "ok"; keys: DevKey[] | null; usage: Usage | null; mock: boolean };

const parseJar = (v: unknown): DevKey[] | null => {
  if (!Array.isArray(v) || v.length > MAX_ACTIVE_KEYS + 5) return null;
  try {
    return v.map(parseKey);
  } catch {
    return null;
  }
};
const toWire = (k: DevKey) => ({ id: k.id, name: k.name, mode: k.mode, prefix: k.prefix, last4: k.last4, scopes: k.scopes, created_at: k.createdAt, last_used_at: k.lastUsedAt, rotated_at: k.rotatedAt, revoked_at: k.revokedAt, ip_allow: k.ipAllow });
const jar = () => readJar<DevKey[]>(COOKIE, parseJar, []);
const keep = async (keys: DevKey[]): Promise<boolean> => writeJar(COOKIE, keys.map(toWire));
const active = (keys: readonly DevKey[]) => keys.filter((k) => k.revokedAt === null).length;
/** The made-up test key: a secret of the real shape (sk_test_ and 40 letters and digits), which opens nothing. */
function madeUp(): { secret: string; prefix: string; last4: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(40);
  const secret = `sk_test_${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
  return { secret, prefix: secret.slice(0, 12), last4: secret.slice(-4) };
}

export async function readDeveloper(token: string, tenantId: string): Promise<DeveloperRead> {
  const mode = developerKeysScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) return { mode: "off" };
  if (mode === "mock") {
    const keys = await jar();
    return { mode: "ok", keys, usage: { today: { requests: 0, leads: 0, callsSimulated: 0 }, month: { requests: 0, leads: 0, callsSimulated: 0 } }, mock: true };
  }
  const settle = async <T>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
      return null;
    }
  };
  const [keys, usage] = await Promise.all([settle(() => listKeys(token, tenantId)), settle(() => getUsage(token, tenantId))]);
  return { mode: "ok", keys, usage, mock: false };
}

const refusal = (status: number, code: string): ApiRequestError => new ApiRequestError(status, code, code);

/** Make a test key. `mock` throws the same refusals the API gives (too_many_keys) so the screen shows the same words. */
export async function makeKey(token: string, tenantId: string, input: KeyInput): Promise<NewKey> {
  if (developerKeysScreens() === "mock") {
    const keys = await jar();
    if (active(keys) >= MAX_ACTIVE_KEYS) throw refusal(409, "too_many_keys");
    const m = madeUp();
    const key: DevKey = { id: randomUUID(), name: input.name, mode: "test", prefix: m.prefix, last4: m.last4, scopes: input.scopes, createdAt: new Date().toISOString(), lastUsedAt: null, rotatedAt: null, revokedAt: null, ipAllow: input.ipAllow };
    if (!(await keep([key, ...keys]))) throw refusal(422, "invalid");
    return { key, secret: m.secret };
  }
  return createKey(token, tenantId, input);
}
export async function newSecret(token: string, tenantId: string, id: string): Promise<NewKey> {
  if (developerKeysScreens() === "mock") {
    const keys = await jar();
    const old = keys.find((k) => k.id === id && k.revokedAt === null);
    if (!old) throw refusal(404, "not_found");
    const m = madeUp();
    const key = { ...old, prefix: m.prefix, last4: m.last4, lastUsedAt: null, rotatedAt: new Date().toISOString() };
    if (!(await keep(keys.map((k) => (k.id === id ? key : k))))) throw refusal(422, "invalid");
    return { key, secret: m.secret };
  }
  return rotateKey(token, tenantId, id);
}
export async function stopKey(token: string, tenantId: string, id: string): Promise<DevKey> {
  if (developerKeysScreens() === "mock") {
    const keys = await jar();
    const old = keys.find((k) => k.id === id);
    if (!old) throw refusal(404, "not_found");
    const key = { ...old, revokedAt: old.revokedAt ?? new Date().toISOString() };
    if (!(await keep(keys.map((k) => (k.id === id ? key : k))))) throw refusal(422, "invalid");
    return key;
  }
  return revokeKey(token, tenantId, id);
}
