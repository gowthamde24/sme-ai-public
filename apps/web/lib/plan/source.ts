import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { CHECKOUT_REF, getBilling, getPlans, postCancel, postTrial, toWorkspacePlan as fromApi } from "./api";
import { CATALOGUE, catalogueFrom } from "./catalogue";
import { planScreens } from "./flag";
import { MOCK_COOKIE, cancel, encodeMock, endTrial, fixPayment, parseMock, startTrial, toWorkspacePlan, type MockState } from "./mock";
import type { PlanCatalogue, PlanCtx, PlanResult, WorkspacePlan } from "./types";

/**
 * Where the plan screens get the plans and a workspace's place in them from, and where their moves go (job DK). `mock` is the in-cookie fake provider (lib/plan/mock.ts); `on` is the API of job DI (lib/plan/api.ts):
 * GET /v1/plans, GET /v1/tenants/{id}/billing, POST …/billing/trial, POST …/billing/cancel. `off` reads nothing. The API has no move to put a failed payment right and none to jump the trial forward, so those two
 * are `not_available` outside the fake cookie. SERVER ONLY.
 */
const REFUSALS: Record<string, Extract<PlanResult, { ok: false }>["error"]> = { plan_unknown: "invalid", trial_already_started: "already", payment_method_declined: "declined", forbidden: "forbidden", api_unreachable: "not_available" };

/** A call to the API that gives an answer, or null (the card says "Not available yet"); a session the API refused goes to the sign-in page. */
async function read<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
async function move(call: () => Promise<unknown>): Promise<PlanResult> {
  try {
    await call();
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: error instanceof ApiRequestError ? (REFUSALS[error.code] ?? "invalid") : "not_available" };
  }
}

const mockState = async (): Promise<MockState> => parseMock((await cookies()).get(MOCK_COOKIE)?.value);
async function save(m: MockState): Promise<void> {
  (await cookies()).set(MOCK_COOKIE, encodeMock(m), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
}
async function mocked(step: (m: MockState) => { next: MockState } | { error: Extract<PlanResult, { ok: false }>["error"] }): Promise<PlanResult> {
  const out = step(await mockState());
  if ("error" in out) return { ok: false, error: out.error };
  await save(out.next);
  return { ok: true };
}

export async function readCatalogue(ctx: PlanCtx): Promise<PlanCatalogue | null> {
  const mode = planScreens();
  if (mode === "mock") return CATALOGUE;
  if (mode !== "on") return null;
  const out = await read(() => getPlans(ctx));
  return out ? catalogueFrom(out) : null;
}

export async function readWorkspacePlan(ctx: PlanCtx, now: Date = new Date()): Promise<WorkspacePlan | null> {
  const mode = planScreens();
  if (mode === "mock") return toWorkspacePlan(await mockState(), now);
  if (mode !== "on") return null;
  const out = await read(() => getBilling(ctx));
  return out ? fromApi(out) : null;
}

export async function startPlanTrial(ctx: PlanCtx, planId: string, method: string): Promise<PlanResult> {
  const mode = planScreens();
  if (mode === "mock") return mocked((m) => startTrial(m, planId, method));
  if (mode !== "on") return { ok: false, error: "not_available" };
  const ref = CHECKOUT_REF[method];
  if (!ref) return { ok: false, error: "no_payment_method" }; // the trial starts WITH a payment method
  return move(() => postTrial(ctx, planId, ref));
}
export async function cancelPlan(ctx: PlanCtx): Promise<PlanResult> {
  const mode = planScreens();
  if (mode === "mock") return mocked(cancel);
  if (mode !== "on") return { ok: false, error: "not_available" };
  return move(() => postCancel(ctx));
}
export async function fixPlanPayment(): Promise<PlanResult> {
  return planScreens() === "mock" ? mocked(fixPayment) : { ok: false, error: "not_available" };
}
export async function endPlanTrial(): Promise<PlanResult> {
  return planScreens() === "mock" ? mocked(endTrial) : { ok: false, error: "not_available" };
}
