import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getAutoReply, putAutoReply } from "@/lib/api/auto-reply";
import { readJar, writeJar } from "@/lib/mock/jar";
import { autoReplyScreens } from "@/lib/screens/flag";

import { RULES, type AutoReply, type AutoReplyError } from "./types";

/**
 * Where the automatic-reply switch is read and changed. `mock` = ONE small cookie with the switch (made-up counts), `on` = C1's API, `off` = the part is not there. Every refusal is a closed word the screen has a sentence for (the API's own English is never passed on); the second
 * factor (`mfa_required`) is its own word, so the screen can say what to do. SERVER ONLY; the Owner's role is checked by the caller.
 */
export type Ctx = { token: string; tenantId: string };
export type Read = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; data: AutoReply };
export type Change = { ok: true; data: AutoReply } | { ok: false; error: AutoReplyError };
export const MOCK_COOKIE = "sme_autoreply_mock";
const mockState = (enabled: boolean): AutoReply => ({ enabled, changedAt: null, answeredToday: enabled ? 7 : 0, heldToday: enabled ? 2 : 0, dailyLimit: 200, rules: [...RULES] });

export async function readAutoReply(ctx: Ctx): Promise<Read> {
  const mode = autoReplyScreens();
  if (mode === "off") return { mode: "off" };
  if (mode === "mock") return { mode: "ok", data: mockState(await readJar(MOCK_COOKIE, (v) => (typeof v === "object" && v !== null && (v as { on?: unknown }).on === true ? true : null), false)) };
  try {
    return { mode: "ok", data: await getAutoReply(ctx.token, ctx.tenantId) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return { mode: "unavailable" };
  }
}

export async function changeAutoReply(ctx: Ctx, enabled: unknown): Promise<Change> {
  if (typeof enabled !== "boolean") return { ok: false, error: "down" };
  const mode = autoReplyScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    await writeJar(MOCK_COOKIE, { on: enabled });
    return { ok: true, data: mockState(enabled) };
  }
  try {
    return { ok: true, data: await putAutoReply(ctx.token, ctx.tenantId, enabled) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError) {
      if (error.code === "mfa_required") return { ok: false, error: "mfa" };
      if (error.code === "auto_reply_unavailable" || error.status === 503) return { ok: false, error: "not_available" };
      if (error.status === 403) return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "down" };
  }
}
