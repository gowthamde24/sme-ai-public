"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { claimNumber, readOwn, searchNumbers } from "@/lib/phone-picker/source";
import type { ClaimResult, OwnNumber, SearchResult } from "@/lib/phone-picker/types";

/** The moves of the number picker. Owner and Admin look for numbers; only the Owner claims (the server needs the second factor too). Every answer is a closed word the screen draws in plain language. */
async function role(tenantId: string): Promise<{ token: string; role: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    return { token: user.accessToken, role: (await fetchTenant(user.accessToken, tenantId)).role };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function searchNumbersAction(tenantId: string, type: unknown, prefix: unknown, page: unknown): Promise<SearchResult> {
  const who = await role(tenantId);
  if (!who || (who.role !== "owner" && who.role !== "admin")) return { ok: false, error: "forbidden" };
  return searchNumbers(who.token, tenantId, type, prefix, page);
}

export async function claimNumberAction(tenantId: string, number: unknown, type: unknown): Promise<ClaimResult> {
  const who = await role(tenantId);
  if (!who || who.role !== "owner") return { ok: false, error: "forbidden" };
  const out = await claimNumber(who.token, tenantId, number, type);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/phone-number`);
  return out;
}

export async function ownNumberAction(tenantId: string): Promise<OwnNumber | null> {
  const who = await role(tenantId);
  return who ? readOwn(who.token, tenantId) : null;
}
