"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { changeEndpoint, createEndpoint, deleteEndpoint, hookFailOf, listActivity, listDeliveries, rotateEndpointSecret, testEndpoint, type Activity, type Deliveries, type Endpoint, type HookFail, type NewEndpoint } from "@/lib/api/webhooks-out";
import { requireUser } from "@/lib/auth/session";

/**
 * The moves of the Webhooks and Activity tabs (Owner and Admin; the API asks for the second factor for every change and decides again; C1's docs/contracts/webhooks-out.md). The secret is in the answer of a create or a rotate ONLY, for the page to show once. The address and the events are
 * checked here before asking (https, at most 500 characters, 1 to 5 known events); the server checks the address again (a name that is not public is refused).
 */
async function gate(tenantId: string, owner = false): Promise<{ token: string } | HookFail> {
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "other" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && (owner || role !== "admin")) return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "other" };
  }
  return { token: user.accessToken };
}
const isFail = (v: { token: string } | HookFail): v is HookFail => "ok" in v;
const EVENT = /^[a-z_]+\.[a-z_]+$/;
function clean(input: unknown): { url: string; events: string[]; sendTranscript: boolean } | null {
  if (typeof input !== "object" || input === null) return null;
  const i = input as Record<string, unknown>;
  const url = typeof i.url === "string" ? i.url.trim() : "";
  const events = Array.isArray(i.events) ? [...new Set(i.events.filter((e): e is string => typeof e === "string" && EVENT.test(e) && e.length <= 40))] : [];
  if (url.length < 8 || url.length > 500 || !url.startsWith("https://") || events.length < 1 || events.length > 10) return null;
  return { url, events, sendTranscript: i.sendTranscript === true };
}
const again = (t: string) => revalidatePath(`/app/tenants/${t}/developers`);

export async function createHookAction(tenantId: string, input: unknown): Promise<{ ok: true; created: NewEndpoint } | HookFail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  const c = clean(input);
  if (!c) return { ok: false, error: "url", reason: "scheme" };
  try {
    const created = await createEndpoint(g.token, tenantId, c);
    again(tenantId);
    return { ok: true, created };
  } catch (error) {
    return hookFailOf(error);
  }
}
export async function changeHookAction(tenantId: string, id: string, input: unknown): Promise<{ ok: true; hook: Endpoint } | HookFail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  const patch: { url?: string; events?: string[]; sendTranscript?: boolean; active?: boolean } = {};
  if (typeof input === "object" && input !== null) {
    const i = input as Record<string, unknown>;
    if ("url" in i || "events" in i) {
      const c = clean({ url: i.url, events: i.events, sendTranscript: i.sendTranscript });
      if (!c) return { ok: false, error: "url", reason: "scheme" };
      patch.url = c.url;
      patch.events = c.events;
      patch.sendTranscript = c.sendTranscript;
    }
    if (typeof i.active === "boolean") patch.active = i.active;
  }
  try {
    const hook = await changeEndpoint(g.token, tenantId, id, patch);
    again(tenantId);
    return { ok: true, hook };
  } catch (error) {
    return hookFailOf(error);
  }
}
export async function rotateHookAction(tenantId: string, id: string): Promise<{ ok: true; created: NewEndpoint } | HookFail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  try {
    const created = await rotateEndpointSecret(g.token, tenantId, id);
    again(tenantId);
    return { ok: true, created };
  } catch (error) {
    return hookFailOf(error);
  }
}
export async function deleteHookAction(tenantId: string, id: string): Promise<{ ok: true } | HookFail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  try {
    await deleteEndpoint(g.token, tenantId, id);
    again(tenantId);
    return { ok: true };
  } catch (error) {
    return hookFailOf(error);
  }
}
export async function testHookAction(tenantId: string, id: string): Promise<{ ok: true } | HookFail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  try {
    await testEndpoint(g.token, tenantId, id);
    return { ok: true };
  } catch (error) {
    return hookFailOf(error);
  }
}
export async function deliveriesAction(tenantId: string, id: string, before: unknown): Promise<{ ok: true; log: Deliveries } | HookFail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  try {
    return { ok: true, log: await listDeliveries(g.token, tenantId, id, typeof before === "string" && before.length <= 80 ? before : null) };
  } catch (error) {
    return hookFailOf(error);
  }
}
export async function activityAction(tenantId: string, before: unknown): Promise<{ ok: true; activity: Activity } | HookFail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  try {
    return { ok: true, activity: await listActivity(g.token, tenantId, typeof before === "string" && before.length <= 80 ? before : null) };
  } catch (error) {
    return hookFailOf(error);
  }
}
