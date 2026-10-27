"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/lead-desk/imports/types";
import { createSourceStep, discardStep, pullStep, rotateStep, sourcesMode, statusStep, type Ctx } from "@/lib/lead-desk/sources/source";
import { checkSourceCreate, type LiveSource, type Out, type PullResult, type SourceWithSecret } from "@/lib/lead-desk/sources/types";

/**
 * The writes of the lead sources page (night 4, Lead Desk, item 4): Owner and Admin only (the API is the real gate, and may ask for the second factor: `mfa`). The input is whatever the browser sent: it is checked in
 * lib/lead-desk/sources/types.ts. A create and a rotate answer with the SECRET (the address, the e-mail address, the form snippet, Meta's callback and verify token) ONCE: it travels in this one answer to the page that shows
 * it and is kept nowhere else; this file never stores or logs it, and the page that is refreshed afterwards is drawn from the list, which has no secret.
 */
async function ctxOf(tenantId: string): Promise<Ctx | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return tenant.role === "owner" || tenant.role === "admin" ? { token: user.accessToken, tenantId } : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const NOT_THERE = { ok: false, error: "not_available" } as const;
const refresh = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}/lead-sources`);
async function signedIn<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    throw error;
  }
}

export async function createSourceAction(tenantId: string, input: unknown): Promise<Out<SourceWithSecret>> {
  const ctx = await ctxOf(tenantId);
  if (!ctx || sourcesMode() === "off") return NOT_THERE;
  const body = checkSourceCreate(input);
  if (!body.ok) return { ok: false, error: body.error };
  const out = await signedIn(() => createSourceStep(ctx, body.value));
  if (out.ok) refresh(tenantId);
  return out;
}

export async function rotateSourceAction(tenantId: string, sourceId: string): Promise<Out<SourceWithSecret>> {
  const ctx = await ctxOf(tenantId);
  if (!ctx || sourcesMode() === "off") return NOT_THERE;
  if (!isUuid(sourceId)) return { ok: false, error: "invalid" };
  const out = await signedIn(() => rotateStep(ctx, sourceId));
  if (out.ok) refresh(tenantId);
  return out;
}

export async function sourceStatusAction(tenantId: string, sourceId: string, what: "pause" | "resume"): Promise<Out<LiveSource>> {
  const ctx = await ctxOf(tenantId);
  if (!ctx || sourcesMode() === "off") return NOT_THERE;
  if (!isUuid(sourceId) || (what !== "pause" && what !== "resume")) return { ok: false, error: "invalid" };
  const out = await signedIn(() => statusStep(ctx, sourceId, what));
  if (out.ok) refresh(tenantId);
  return out;
}

export async function pullIndiaMartAction(tenantId: string): Promise<Out<PullResult>> {
  const ctx = await ctxOf(tenantId);
  if (!ctx || sourcesMode() === "off") return NOT_THERE;
  const out = await signedIn(() => pullStep(ctx));
  if (out.ok) refresh(tenantId);
  return out;
}

export async function discardUnparsedAction(tenantId: string, id: string): Promise<Out<null>> {
  const ctx = await ctxOf(tenantId);
  if (!ctx || sourcesMode() === "off") return NOT_THERE;
  if (!isUuid(id)) return { ok: false, error: "invalid" };
  const out = await signedIn(() => discardStep(ctx, id));
  if (out.ok) refresh(tenantId);
  return out;
}
