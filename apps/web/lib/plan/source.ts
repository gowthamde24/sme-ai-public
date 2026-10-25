import { cookies } from "next/headers";

import { planScreens } from "./flag";
import { MOCK_COOKIE, cancel, encodeMock, endTrial, fixPayment, parseMock, startTrial, toWorkspacePlan, type MockState } from "./mock";
import type { PlanResult, WorkspacePlan } from "./types";

/**
 * Where the plan screens get a workspace's plan from, and where their three actions go (job DK). The one file that changes when C1's plans API (job DI) arrives: `on` will call it; until then `on` says "not available"
 * (null) and an action refuses with `not_available`. `mock` is the in-cookie fake provider (lib/plan/mock.ts). SERVER ONLY.
 */
export async function readWorkspacePlan(now: Date = new Date()): Promise<WorkspacePlan | null> {
  if (planScreens() !== "mock") return null;
  return toWorkspacePlan(parseMock((await cookies()).get(MOCK_COOKIE)?.value), now);
}

async function save(m: MockState): Promise<void> {
  (await cookies()).set(MOCK_COOKIE, encodeMock(m), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
}

export async function startPlanTrial(planId: string, method: string): Promise<PlanResult> {
  if (planScreens() !== "mock") return { ok: false, error: "not_available" };
  const out = startTrial(parseMock((await cookies()).get(MOCK_COOKIE)?.value), planId, method);
  if ("error" in out) return { ok: false, error: out.error };
  await save(out.next);
  return { ok: true };
}
export async function cancelPlan(): Promise<PlanResult> {
  if (planScreens() !== "mock") return { ok: false, error: "not_available" };
  const out = cancel(parseMock((await cookies()).get(MOCK_COOKIE)?.value));
  if ("error" in out) return { ok: false, error: out.error };
  await save(out.next);
  return { ok: true };
}
export async function fixPlanPayment(): Promise<PlanResult> {
  if (planScreens() !== "mock") return { ok: false, error: "not_available" };
  const out = fixPayment(parseMock((await cookies()).get(MOCK_COOKIE)?.value));
  if ("error" in out) return { ok: false, error: out.error };
  await save(out.next);
  return { ok: true };
}
export async function endPlanTrial(): Promise<PlanResult> {
  if (planScreens() !== "mock") return { ok: false, error: "not_available" };
  const out = endTrial(parseMock((await cookies()).get(MOCK_COOKIE)?.value));
  if ("error" in out) return { ok: false, error: out.error };
  await save(out.next);
  return { ok: true };
}
