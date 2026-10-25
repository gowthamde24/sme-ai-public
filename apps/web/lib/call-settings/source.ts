import { cookies } from "next/headers";

import { ApiRequestError } from "@/lib/api/client";
import { getCallSettings, putCallSettings } from "@/lib/api/call-settings";
import { callSettingsScreens } from "@/lib/screens/flag";

import { defaultCallSettings, enforceSchool, parseCallSettings, purposesFor, type CallSettingsRead } from "./types";

/**
 * Where the call settings come from and go (job DP). `mock` = ONE cookie of the browser (checked by `parseCallSettings` on every read; a value that does not fit in a cookie, about 3.5 KB, is not saved: the test screen says so);
 * `on` = C1's API (lib/api/call-settings.ts); `off` = the section is not there. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_callsettings_mock";
export type Ctx = { token: string; tenantId: string };
export type CallRead = { mode: "off" } | { mode: "unavailable" } | ({ mode: "ok" } & CallSettingsRead);
export type SaveResult = { ok: true } | { ok: false; error: "not_available" | "invalid" | "mfa" | "locked" | "read_only" };
const COOKIE_MAX = 3500;

export async function readCallSettings(ctx: Ctx, modules: readonly string[] | null): Promise<CallRead> {
  const mode = callSettingsScreens();
  if (mode === "off") return { mode: "off" };
  const locked = purposesFor(modules);
  if (mode === "on") {
    try {
      const got = await getCallSettings(ctx.token, ctx.tenantId, modules);
      return { mode: "ok", settings: enforceSchool(got.settings, got.lockedPurposes), lockedPurposes: got.lockedPurposes, saved: got.saved };
    } catch {
      return { mode: "unavailable" };
    }
  }
  try {
    const raw = (await cookies()).get(MOCK_COOKIE)?.value;
    const own = raw ? parseCallSettings(JSON.parse(raw)) : null;
    if (own) return { mode: "ok", settings: enforceSchool(own, locked), lockedPurposes: locked, saved: true };
  } catch {
    // not JSON: ignored, the defaults are used
  }
  return { mode: "ok", settings: defaultCallSettings(modules), lockedPurposes: locked, saved: false };
}

export async function saveCallSettings(ctx: Ctx, input: unknown, modules: readonly string[] | null): Promise<SaveResult> {
  const mode = callSettingsScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  const parsed = parseCallSettings(input);
  if (!parsed) return { ok: false, error: "invalid" };
  const locked = purposesFor(modules);
  if (locked !== null && parsed.allowed_purposes.some((p) => !locked.includes(p))) return { ok: false, error: "locked" };
  if (mode === "on") {
    try {
      await putCallSettings(ctx.token, ctx.tenantId, parsed);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === "mfa_required") return { ok: false, error: "mfa" };
        if (error.code === "locked_for_business_type") return { ok: false, error: "locked" };
        if (error.code === "workspace_read_only") return { ok: false, error: "read_only" };
        if (error.status === 422) return { ok: false, error: "invalid" };
      }
      return { ok: false, error: "not_available" };
    }
  }
  const text = JSON.stringify(parsed);
  if (text.length > COOKIE_MAX) return { ok: false, error: "invalid" };
  (await cookies()).set(MOCK_COOKIE, text, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return { ok: true };
}
