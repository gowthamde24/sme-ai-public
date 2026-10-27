import { cookies } from "next/headers";

import { ApiRequestError } from "@/lib/api/client";
import { clearCampaignOverride, getCampaignCalls, putCampaignOverride } from "@/lib/api/campaign-call-settings";
import { callSettingsScreens } from "@/lib/screens/flag";

import { applyOverride, overriddenFields, parseOverride, type CampaignOverride, type OverridableField } from "./campaign";
import { readCallSettings, type Ctx, type SaveResult } from "./source";
import type { CallSettings } from "./types";

/**
 * Where a campaign's call settings come from and go (job DQ part 3). `mock` = ONE cookie of the browser holding the overrides of a few campaigns (checked on every read; the workspace's settings come from lib/call-settings/source.ts);
 * `on` = C1's API (lib/api/campaign-call-settings.ts); `off` = the parts are not there. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_callsettings_campaign_mock";
const COOKIE_MAX = 3500;
export type CampaignCalls = { mode: "off" } | { mode: "unavailable" } | { mode: "ok"; base: CallSettings; effective: CallSettings; overridden: OverridableField[]; lockedPurposes: readonly string[] | null };

async function mockOverrides(): Promise<Record<string, unknown>> {
  try {
    const raw = (await cookies()).get(MOCK_COOKIE)?.value;
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function readCampaignCalls(ctx: Ctx, campaignId: string, modules: readonly string[] | null): Promise<CampaignCalls> {
  const mode = callSettingsScreens();
  if (mode === "off") return { mode: "off" };
  const workspace = await readCallSettings(ctx, modules);
  if (workspace.mode !== "ok") return { mode: workspace.mode === "off" ? "off" : "unavailable" };
  const base = workspace.settings;
  if (mode === "on") {
    try {
      const got = await getCampaignCalls(ctx.token, ctx.tenantId, campaignId);
      return { mode: "ok", base, effective: got.effective, overridden: got.overridden, lockedPurposes: workspace.lockedPurposes };
    } catch {
      return { mode: "unavailable" };
    }
  }
  const own = parseOverride((await mockOverrides())[campaignId], base) ?? {};
  const effective = applyOverride(base, own);
  return { mode: "ok", base, effective, overridden: overriddenFields(base, effective), lockedPurposes: workspace.lockedPurposes };
}

/** Save the override of one campaign: what is different from the workspace's settings (`{}` = nothing: the override is removed). */
export async function saveCampaignOverride(ctx: Ctx, campaignId: string, input: unknown, modules: readonly string[] | null): Promise<SaveResult> {
  const mode = callSettingsScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  const workspace = await readCallSettings(ctx, modules);
  if (workspace.mode !== "ok") return { ok: false, error: "not_available" };
  const parsed: CampaignOverride | null = parseOverride(input, workspace.settings);
  if (parsed === null) return { ok: false, error: "invalid" };
  if (mode === "on") {
    try {
      await putCampaignOverride(ctx.token, ctx.tenantId, campaignId, parsed);
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
  const all = await mockOverrides();
  if (Object.keys(parsed).length === 0) delete all[campaignId];
  else all[campaignId] = parsed;
  const text = JSON.stringify(all);
  if (text.length > COOKIE_MAX) return { ok: false, error: "invalid" };
  (await cookies()).set(MOCK_COOKIE, text, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return { ok: true };
}

export async function clearCampaign(ctx: Ctx, campaignId: string): Promise<SaveResult> {
  const mode = callSettingsScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") {
    try {
      await clearCampaignOverride(ctx.token, ctx.tenantId, campaignId);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === "mfa_required") return { ok: false, error: "mfa" };
        if (error.code === "workspace_read_only") return { ok: false, error: "read_only" };
      }
      return { ok: false, error: "not_available" };
    }
  }
  const all = await mockOverrides();
  delete all[campaignId];
  (await cookies()).set(MOCK_COOKIE, JSON.stringify(all), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return { ok: true };
}
