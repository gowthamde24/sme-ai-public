"use server";

import { redirect } from "next/navigation";

import { endDemoCall, startDemoCall } from "@/lib/api/demo-call";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { demoCall } from "@/lib/screens/flag";
import { readIsDemo } from "./today-read";

export type DemoCallResult = { ok: boolean };

/** Only where the flag is on, for the Owner or an Admin of a workspace that is a DEMO one (the API's own word on billing/access); the API refuses anything else with a 404 anyway. */
async function allowed(tenantId: string): Promise<string | null> {
  const user = await requireUser();
  if (!demoCall() || !isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if ((tenant.role !== "owner" && tenant.role !== "admin") || !(await readIsDemo(user.accessToken, tenantId, tenant.name))) return null;
    return user.accessToken;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

/** "Start demo call" (Today): the simulated live call of C1's demo routes. Bound to the workspace by the page (`startDemoCallAction.bind(null, tenantId)`). */
export async function startDemoCallAction(tenantId: string): Promise<DemoCallResult> {
  const token = await allowed(tenantId);
  if (token === null) return { ok: false };
  try {
    await startDemoCall(token, tenantId);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
}

export async function endDemoCallAction(tenantId: string): Promise<DemoCallResult> {
  const token = await allowed(tenantId);
  if (token === null) return { ok: false };
  try {
    await endDemoCall(token, tenantId);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
}
