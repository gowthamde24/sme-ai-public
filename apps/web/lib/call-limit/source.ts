import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { CALL_LIMIT_MAX, CALL_LIMIT_MIN, readCallLimit, writeCallLimit, type CallLimit } from "@/lib/api/call-limit";
import { readJar, writeJar } from "@/lib/mock/jar";
import { callLimitScreens } from "@/lib/screens/flag";

/**
 * Where the calls-a-day limit comes from: `mock` = ONE cookie of this browser (a made-up "used today"), `1` = C1's `/tasks/call-limit`, off = the card is not there. A number is checked here (1 to 5000, whole). SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_calllimit_mock";
const MOCK_USED = 23;
const DEFAULT = 100;
export type LimitFail = "range" | "forbidden" | "down";

const mockLimit = (limit: number): CallLimit => ({ limit, used: MOCK_USED, remaining: Math.max(0, limit - MOCK_USED), defaultLimit: DEFAULT });
const parseJar = (v: unknown): number | null => (typeof v === "object" && v !== null && typeof (v as { limit?: unknown }).limit === "number" && Number.isInteger((v as { limit: number }).limit) && (v as { limit: number }).limit >= CALL_LIMIT_MIN && (v as { limit: number }).limit <= CALL_LIMIT_MAX ? (v as { limit: number }).limit : null);

export async function readLimit(token: string, tenantId: string): Promise<{ mode: "off" } | { mode: "unavailable" } | { mode: "ok"; mock: boolean; data: CallLimit }> {
  const mode = callLimitScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", mock: true, data: mockLimit(await readJar(MOCK_COOKIE, parseJar, DEFAULT)) };
  try {
    return { mode: "ok", mock: false, data: await readCallLimit(token, tenantId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

export async function saveLimit(token: string, tenantId: string, limit: unknown): Promise<{ ok: true; data: CallLimit } | { ok: false; error: LimitFail }> {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < CALL_LIMIT_MIN || limit > CALL_LIMIT_MAX) return { ok: false, error: "range" };
  const mode = callLimitScreens();
  if (mode === "off") return { ok: false, error: "down" };
  if (mode === "mock") return (await writeJar(MOCK_COOKIE, { limit })) ? { ok: true, data: mockLimit(limit) } : { ok: false, error: "down" };
  try {
    return { ok: true, data: await writeCallLimit(token, tenantId, limit) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 422 || error.status === 400) return { ok: false, error: "range" };
    }
    return { ok: false, error: "down" };
  }
}
