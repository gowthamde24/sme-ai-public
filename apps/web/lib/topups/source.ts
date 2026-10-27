import { cache } from "react";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getInvoices, getTopups, getUpgradePreview, getUsageView, postTopup, postUpgrade, putTopupSettings } from "@/lib/api/topups";
import { CHECKOUT_REF } from "@/lib/plan/api";
import { CATALOGUE } from "@/lib/plan/catalogue";
import { readWorkspacePlan } from "@/lib/plan/source";
import { readJar, writeJar } from "@/lib/mock/jar";
import { topupScreens } from "@/lib/screens/flag";

import { MOCK_COOKIE, buyPack, mockTopups, mockUsage, parseMock, previewUpgrade as mockPreview, setSettings, simulate, upgrade as mockUpgrade, FRESH, type MockState } from "./mock";
import type { PreviewResult, SettingsInput, TopupCtx, TopupError, TopupResult, TopupsView, UsageView } from "./types";

/**
 * Where the top-up screens get their numbers from and where their moves go (night 4, part F2). `mock` = the fake provider in ONE cookie (lib/topups/mock.ts), `on` = C1's API (lib/api/topups.ts, contract-topups.md), `off` = the
 * parts are not there (every read is null, every move `not_available`). Reads that fail answer null (the part says "Not available yet"); a session the API refused goes to the sign-in page. SERVER ONLY. The payment is FAKE
 * everywhere: the checkout sheet only chooses between two test outcomes.
 */
const REFUSALS: Record<string, TopupError> = {
  mfa_required: "mfa",
  workspace_read_only: "read_only",
  payment_method_declined: "declined",
  no_subscription: "no_plan",
  pack_unknown: "pack_unknown",
  pack_wrong_kind: "invalid",
  cap_required: "cap_required",
  not_an_upgrade: "not_an_upgrade",
  plan_unknown: "invalid",
  purchase_id_used: "conflict",
  forbidden: "forbidden",
  billing_unavailable: "not_available",
  api_unreachable: "not_available",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The two test outcomes of the fake checkout (the API's fake provider knows them as pm_fake_ok and pm_fake_declined). */
export const TEST_METHODS = ["test_ok", "test_declined"] as const;

/** An API refusal as a word of ours. */
export function refusalOf(error: unknown): TopupError {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    const known = REFUSALS[error.code];
    if (known) return known;
    if (error.status === 403) return "forbidden";
    if (error.status === 402) return "declined";
    if (error.status === 409) return "conflict";
    if (error.status === 422) return "invalid";
  }
  return "not_available";
}
async function move(call: () => Promise<unknown>): Promise<TopupResult> {
  try {
    await call();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: refusalOf(error) };
  }
}

const now = (): Date => new Date();
async function mockState(): Promise<MockState> {
  const fresh = FRESH(now());
  return readJar(MOCK_COOKIE, (v) => parseMock(v, now()), fresh);
}
/** Keeps a state; a state that does not fit in the cookie is refused (never cut). */
async function keep(s: MockState): Promise<TopupResult> {
  return (await writeJar(MOCK_COOKIE, s, 30)) ? { ok: true } : { ok: false, error: "invalid" };
}
/** The plan the Plan part itself shows (test mode picks up its id so the two agree), or null. */
async function shownPlan(ctx: TopupCtx): Promise<string | null> {
  try {
    return (await readWorkspacePlan(ctx))?.planId ?? null;
  } catch {
    return null;
  }
}

export async function readUsage(ctx: TopupCtx): Promise<UsageView | null> {
  const mode = topupScreens();
  if (mode === "off") return null;
  if (mode === "mock") return mockUsage(await mockState(), await shownPlan(ctx), now());
  try {
    return await getUsageView(ctx.token, ctx.tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
/** The small read once per request: the workspace's layout (the banner), Today and the Plan part all want it. */
export const readUsageCached = cache((token: string, tenantId: string) => readUsage({ token, tenantId }));

export async function readTopups(ctx: TopupCtx): Promise<TopupsView | null> {
  const mode = topupScreens();
  if (mode === "off") return null;
  if (mode === "mock") return mockTopups(await mockState(), await shownPlan(ctx), now());
  try {
    const usage = await readUsageCached(ctx.token, ctx.tenantId);
    if (!usage) return null;
    const view = await getTopups(ctx.token, ctx.tenantId, usage);
    // the invoices are a second, separate list; without it the part still works
    const invoices = await getInvoices(ctx.token, ctx.tenantId).catch((e: unknown) => {
      if (e instanceof ApiAuthError) throw e;
      return [];
    });
    return { ...view, invoices };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function buyTopup(ctx: TopupCtx, purchaseId: string, packCode: string, method: string): Promise<TopupResult> {
  const mode = topupScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (!UUID.test(purchaseId) || !/^[a-z0-9_]{1,40}$/.test(packCode) || !(TEST_METHODS as readonly string[]).includes(method)) return { ok: false, error: "invalid" };
  if (mode === "on") return move(() => postTopup(ctx.token, ctx.tenantId, purchaseId, packCode, CHECKOUT_REF[method]));
  if (method === "test_declined") return { ok: false, error: "declined" };
  const out = buyPack(await mockState(), purchaseId, packCode, now());
  return "error" in out ? { ok: false, error: out.error } : keep(out.next);
}

export async function saveTopupSettings(ctx: TopupCtx, input: SettingsInput): Promise<TopupResult> {
  const mode = topupScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "on") return move(() => putTopupSettings(ctx.token, ctx.tenantId, input));
  const out = setSettings(await mockState(), input, now());
  return "error" in out ? { ok: false, error: out.error } : keep(out.next);
}

export async function previewPlanUpgrade(ctx: TopupCtx, planId: string): Promise<PreviewResult> {
  const mode = topupScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (!/^[a-z0-9_]{1,40}$/.test(planId)) return { ok: false, error: "invalid" };
  if (mode === "on") {
    try {
      return { ok: true, preview: await getUpgradePreview(ctx.token, ctx.tenantId, planId) };
    } catch (error) {
      return { ok: false, error: refusalOf(error) };
    }
  }
  const out = mockPreview(await mockState(), await shownPlan(ctx), planId, now(), CATALOGUE);
  return "error" in out ? { ok: false, error: out.error } : { ok: true, preview: out };
}

export async function upgradePlan(ctx: TopupCtx, planId: string, method: string): Promise<TopupResult> {
  const mode = topupScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (!/^[a-z0-9_]{1,40}$/.test(planId) || !(TEST_METHODS as readonly string[]).includes(method)) return { ok: false, error: "invalid" };
  if (mode === "on") return move(() => postUpgrade(ctx.token, ctx.tenantId, planId, CHECKOUT_REF[method]));
  if (method === "test_declined") return { ok: false, error: "declined" };
  const out = mockUpgrade(await mockState(), await shownPlan(ctx), planId, now(), CATALOGUE);
  return "error" in out ? { ok: false, error: out.error } : keep(out.next);
}

/** Test mode only: set the usage to 0 (a new month), 50, 80 or 100 percent so the notices can be looked at. */
export async function simulateUsage(ctx: TopupCtx, percent: number): Promise<TopupResult> {
  if (topupScreens() !== "mock") return { ok: false, error: "not_available" };
  const out = simulate(await mockState(), await shownPlan(ctx), percent, now(), CATALOGUE);
  return "error" in out ? { ok: false, error: out.error } : keep(out.next);
}
