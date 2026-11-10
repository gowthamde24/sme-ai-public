import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getTakeOver, putTakeOver } from "@/lib/api/take-over";
import { readJar, writeJar } from "@/lib/mock/jar";
import { callScreens } from "@/lib/screens/flag";

import type { TakeOver, TakeOverError } from "./types";

/**
 * Where the take-over switch is read and changed. Follows the call screens' flag (CALL_SCREENS): `mock` = ONE small cookie with the switch, `on` = C1's API, `off` = the part is not there. Every refusal is a closed word the
 * screen has a sentence for. SERVER ONLY; the Owner's role is checked by the caller.
 */
export type Ctx = { token: string; tenantId: string };
export type Read = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: TakeOver };
export type Change = { ok: true; data: TakeOver } | { ok: false; error: TakeOverError };
export const MOCK_COOKIE = "sme_takeover_mock";
const mockState = (enabled: boolean): TakeOver => ({ enabled, changedAt: null, announces: false });

export async function readTakeOver(ctx: Ctx): Promise<Read> {
  const mode = callScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", data: mockState(await readJar(MOCK_COOKIE, (v) => (typeof v === "object" && v !== null && (v as { on?: unknown }).on === true ? true : null), false)) };
  try {
    return { mode: "ok", data: await getTakeOver(ctx.token, ctx.tenantId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

export async function changeTakeOver(ctx: Ctx, enabled: unknown): Promise<Change> {
  if (typeof enabled !== "boolean") return { ok: false, error: "down" };
  const mode = callScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    await writeJar(MOCK_COOKIE, { on: enabled });
    return { ok: true, data: mockState(enabled) };
  }
  try {
    return { ok: true, data: await putTakeOver(ctx.token, ctx.tenantId, enabled) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) {
      if (error.status === 503) return { ok: false, error: "not_available" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "down" };
  }
}
