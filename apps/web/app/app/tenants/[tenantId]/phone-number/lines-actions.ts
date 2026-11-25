"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { addExtraLine, moveExtraLine } from "@/lib/extra-lines/source";
import type { LineResult } from "@/lib/extra-lines/types";

/** The moves of "Calls at once": add a line, cancel it for the end of the month, keep it. Only the Owner does them (the server checks again, and asks for the second factor when it is on). Every answer is a closed word. */
async function owner(tenantId: string): Promise<{ token: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return tenant.role === "owner" ? { token: user.accessToken } : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

async function done(tenantId: string, out: LineResult): Promise<LineResult> {
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/phone-number`);
  return out;
}

export async function addLineAction(tenantId: string, key: unknown): Promise<LineResult> {
  const who = await owner(tenantId);
  return who ? done(tenantId, await addExtraLine(who.token, tenantId, key)) : { ok: false, error: "forbidden" };
}

export async function cancelLineAction(tenantId: string, lineId: unknown): Promise<LineResult> {
  const who = await owner(tenantId);
  return who ? done(tenantId, await moveExtraLine(who.token, tenantId, lineId, "cancel")) : { ok: false, error: "forbidden" };
}

export async function keepLineAction(tenantId: string, lineId: unknown): Promise<LineResult> {
  const who = await owner(tenantId);
  return who ? done(tenantId, await moveExtraLine(who.token, tenantId, lineId, "keep")) : { ok: false, error: "forbidden" };
}
