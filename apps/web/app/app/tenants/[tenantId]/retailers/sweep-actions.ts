"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { addSweep, dropSweep, editSweep, runNow } from "@/lib/lead-finder/sweeps-source";
import { sweepProblem, type Sweep, type SweepChange, type SweepRun } from "@/lib/lead-finder/sweeps";
import { sweepScreens } from "@/lib/screens/flag";

import { DECIDERS, invalid, refusal, who, type Refused } from "./finder-guard";

/**
 * The changes of the weekly search (job sweep-screens; C1's PROPOSAL docs/contracts/lead-finder-sweep.md): add one (the Owner's or an Admin's standing OK for exactly that search, up to its cap), pause or resume it, change its day, hour
 * and cap, run it now, remove it. Each checks the flag, then who is asking (the API checks again), then the input, then asks with the person's own token. A weekly search NEVER dials anyone: it only finds businesses and puts them
 * in Prospects. With SWEEP_SCREENS=mock nothing is searched and nothing leaves the browser's own cookie.
 */
const touch = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}/retailers`);

/** The sweep's own refusals have sentences of their own; the rest are the Lead Finder's (not_a_search, the day's cap, a school's words, the plan). */
function sweepRefusal(error: unknown, t: Parameters<typeof refusal>[1], lang: string): Refused {
  if (error instanceof ApiRequestError && error.code === "sweep_limit_reached") return { ok: false, kind: "conflict", error: t("sw.err.limit"), code: "sweep_limit_reached" };
  return refusal(error, t, lang);
}

export async function addSweepAction(tenantId: string, input: unknown): Promise<Reply<Sweep>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (sweepScreens() === "off") return invalid(ctx.t);
  const o = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  if (!o || typeof o.text !== "string" || typeof o.weekday !== "number" || typeof o.hour !== "number" || typeof o.maxResults !== "number") return invalid(ctx.t);
  const lang = await getLang();
  const clean = { text: o.text, language: lang, weekday: o.weekday, hour: o.hour, maxResults: o.maxResults };
  const problem = sweepProblem(clean);
  if (problem === "empty" || problem === "too_long") return invalid(ctx.t, problem === "too_long" ? "lf.find.too_long" : "lf.find.empty");
  if (problem) return invalid(ctx.t);
  try {
    const data = await addSweep({ token: ctx.token, tenantId }, clean);
    touch(tenantId);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return sweepRefusal(error, ctx.t, lang);
  }
}

export async function changeSweepAction(tenantId: string, sweepId: string, change: unknown): Promise<Reply<Sweep>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (sweepScreens() === "off" || typeof sweepId !== "string" || !isCanonicalUuid(sweepId) || typeof change !== "object" || change === null) return invalid(ctx.t);
  const c = change as Record<string, unknown>;
  const out: SweepChange = {};
  if (c.weekday !== undefined) {
    if (typeof c.weekday !== "number" || !Number.isInteger(c.weekday) || c.weekday < 1 || c.weekday > 7) return invalid(ctx.t);
    out.weekday = c.weekday;
  }
  if (c.hour !== undefined) {
    if (typeof c.hour !== "number" || !Number.isInteger(c.hour) || c.hour < 0 || c.hour > 23) return invalid(ctx.t);
    out.hour = c.hour;
  }
  if (c.maxResults !== undefined) {
    if (typeof c.maxResults !== "number" || !Number.isInteger(c.maxResults) || c.maxResults < 1 || c.maxResults > 20) return invalid(ctx.t);
    out.maxResults = c.maxResults;
  }
  if (c.enabled !== undefined) {
    if (typeof c.enabled !== "boolean") return invalid(ctx.t);
    out.enabled = c.enabled;
  }
  if (Object.keys(out).length === 0) return invalid(ctx.t);
  const lang = await getLang();
  try {
    const data = await editSweep({ token: ctx.token, tenantId }, sweepId, out);
    touch(tenantId);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return sweepRefusal(error, ctx.t, lang);
  }
}

/** Run it now: the Owner's or an Admin's click is the OK; it counts as a search today (the day's cap says no, in words, when it is used up). */
export async function runSweepAction(tenantId: string, sweepId: string): Promise<Reply<SweepRun>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (sweepScreens() === "off" || typeof sweepId !== "string" || !isCanonicalUuid(sweepId)) return invalid(ctx.t);
  const lang = await getLang();
  try {
    const data = await runNow({ token: ctx.token, tenantId }, sweepId);
    touch(tenantId);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return sweepRefusal(error, ctx.t, lang);
  }
}

/** Take it off the list for good (what it already found stays in Prospects). */
export async function removeSweepAction(tenantId: string, sweepId: string): Promise<Reply<{ removed: true }>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (sweepScreens() === "off" || typeof sweepId !== "string" || !isCanonicalUuid(sweepId)) return invalid(ctx.t);
  const lang = await getLang();
  try {
    await dropSweep({ token: ctx.token, tenantId }, sweepId);
    touch(tenantId);
    return { ok: true, data: { removed: true } };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return sweepRefusal(error, ctx.t, lang);
  }
}
