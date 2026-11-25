"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { change, connect, disconnect, failOf, listDeliveries, retryDead, testConnection, type Connection, type Deliveries, type Fail, type TestResult } from "@/lib/api/crm-push";
import { isCanonicalUuid } from "@/lib/api/crm";
import { crmPushScreens } from "@/lib/screens/flag";
import { requireUser } from "@/lib/auth/session";

/**
 * The moves of the Connectors page (Owner and Admin; the API asks for the second factor for every change and decides again; docs/contracts/crm-push.md). A key is typed into the form, goes to the API in this one call and is never kept here, logged or
 * returned. What is checked here before asking: the tool is a known kind of word, every key and setting is plain text of a sane length, the events are the five known ones. The server checks them all again.
 */
async function gate(tenantId: string): Promise<{ token: string } | Fail> {
  if (!isCanonicalUuid(tenantId) || crmPushScreens() !== "1") return { ok: false, error: "other" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "other" };
  }
  return { token: user.accessToken };
}
const isFail = (v: { token: string } | Fail): v is Fail => "ok" in v;
const TYPE = /^[a-z0-9_]{2,30}$/;
const EVENT = /^[a-z_]+\.[a-z_]+$/;
const KEY = /^[a-z_]{1,30}$/;
const again = (t: string) => revalidatePath(`/app/tenants/${t}/connectors`);

function texts(input: unknown, max: number): Record<string, string> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!KEY.test(k) || typeof v !== "string" || v.length > max) return null;
    out[k] = v;
  }
  return Object.keys(out).length <= 20 ? out : null;
}
function names(input: unknown): Record<string, string> | null {
  const t = texts(input, 60);
  return t;
}
function events(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const list = [...new Set(input.filter((e): e is string => typeof e === "string" && EVENT.test(e) && e.length <= 40))];
  return list.length >= 1 && list.length <= 5 ? list : null;
}

export async function connectAction(tenantId: string, type: string, input: unknown): Promise<{ ok: true; connection: Connection } | Fail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!TYPE.test(type) || typeof input !== "object" || input === null) return { ok: false, error: "other" };
  const i = input as Record<string, unknown>;
  const credentials = texts(i.credentials, 600);
  const settings = texts(i.settings ?? {}, 200);
  if (!credentials || !settings) return { ok: false, error: "credentials" };
  const mapping = i.mapping === undefined ? undefined : names(i.mapping);
  if (mapping === null) return { ok: false, error: "mapping" };
  try {
    const connection = await connect(g.token, tenantId, type, { credentials, settings, ...(mapping ? { mapping } : {}) });
    again(tenantId);
    return { ok: true, connection };
  } catch (error) {
    return failOf(error);
  }
}

export async function changeAction(tenantId: string, type: string, input: unknown): Promise<{ ok: true; connection: Connection } | Fail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!TYPE.test(type) || typeof input !== "object" || input === null) return { ok: false, error: "other" };
  const i = input as Record<string, unknown>;
  const patch: { mapping?: Record<string, string>; events?: string[]; active?: boolean } = {};
  if ("mapping" in i) {
    const m = names(i.mapping);
    if (!m) return { ok: false, error: "mapping" };
    patch.mapping = m;
  }
  if ("events" in i) {
    const e = events(i.events);
    if (!e) return { ok: false, error: "other" };
    patch.events = e;
  }
  if (typeof i.active === "boolean") patch.active = i.active;
  try {
    const connection = await change(g.token, tenantId, type, patch);
    again(tenantId);
    return { ok: true, connection };
  } catch (error) {
    return failOf(error);
  }
}

export async function disconnectAction(tenantId: string, type: string): Promise<{ ok: true } | Fail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!TYPE.test(type)) return { ok: false, error: "other" };
  try {
    await disconnect(g.token, tenantId, type);
    again(tenantId);
    return { ok: true };
  } catch (error) {
    return failOf(error);
  }
}

export async function testAction(tenantId: string, type: string): Promise<{ ok: true; result: TestResult } | Fail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!TYPE.test(type)) return { ok: false, error: "other" };
  try {
    return { ok: true, result: await testConnection(g.token, tenantId, type) };
  } catch (error) {
    return failOf(error);
  }
}

export async function logAction(tenantId: string, type: string, before: unknown): Promise<{ ok: true; log: Deliveries } | Fail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!TYPE.test(type)) return { ok: false, error: "other" };
  try {
    return { ok: true, log: await listDeliveries(g.token, tenantId, type, typeof before === "string" && before.length <= 200 ? before : null) };
  } catch (error) {
    return failOf(error);
  }
}

export async function retryAction(tenantId: string, type: string): Promise<{ ok: true; requeued: number } | Fail> {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!TYPE.test(type)) return { ok: false, error: "other" };
  try {
    const requeued = await retryDead(g.token, tenantId, type);
    again(tenantId);
    return { ok: true, requeued };
  } catch (error) {
    return failOf(error);
  }
}
