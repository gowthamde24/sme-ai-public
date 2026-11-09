"use server";

import { revalidatePath } from "next/cache";

import { HELPERS, type Helper, type Standup } from "@/lib/api/ai-team";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { dayOrToday, remakeStandup, setSwitch, teamContext } from "./ai-team-data";

export type SwitchResult = { ok: true; enabled: boolean } | { ok: false; error: "mfa" | "forbidden" | "signin" | "failed" };
export type StandupResult = { ok: true; standup: Standup } | { ok: false; error: "limit" | "forbidden" | "signin" | "failed" };

const why = (error: unknown): "mfa" | "forbidden" | "signin" | "limit" | "failed" => {
  if (error instanceof ApiAuthError) return "signin";
  if (error instanceof ApiRequestError) {
    if (error.status === 403 && error.code === "mfa_required") return "mfa";
    if (error.status === 403) return "forbidden";
    if (error.status === 429) return "limit";
  }
  return "failed";
};

/** A helper on or off (Owner or Admin with the second factor; the API decides and logs it). Off: it acts on nothing automatically, what it would have done waits. */
export async function switchHelperAction(tenantId: string, helper: string, enabled: boolean): Promise<SwitchResult> {
  if (!(HELPERS as readonly string[]).includes(helper) || typeof enabled !== "boolean") return { ok: false, error: "failed" };
  try {
    const ctx = await teamContext(tenantId);
    if (!ctx) return { ok: false, error: "failed" };
    if (ctx.role !== "owner" && ctx.role !== "admin") return { ok: false, error: "forbidden" };
    const now = await setSwitch(ctx, helper as Helper, enabled);
    revalidatePath(`/app/tenants/${tenantId}/ai-team`);
    return { ok: true, enabled: now };
  } catch (error) {
    const w = why(error);
    return { ok: false, error: w === "limit" ? "failed" : w };
  }
}

/** "Make it again": the stand-up made now from the day's data (at most 3 a day per workspace). */
export async function remakeStandupAction(tenantId: string, date: string): Promise<StandupResult> {
  try {
    const ctx = await teamContext(tenantId);
    if (!ctx) return { ok: false, error: "failed" };
    if (ctx.role !== "owner" && ctx.role !== "admin") return { ok: false, error: "forbidden" };
    const made = await remakeStandup(ctx, dayOrToday(date));
    return made === "limit" ? { ok: false, error: "limit" } : { ok: true, standup: made };
  } catch (error) {
    const w = why(error);
    return { ok: false, error: w === "mfa" ? "forbidden" : w };
  }
}
