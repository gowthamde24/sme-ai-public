"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { assignLead, type AssignResult } from "@/lib/lead-desk/leads-source";
import { leadsScreens } from "@/lib/screens/flag";

/** Hand a lead to a team member (night 4, part A6): the Owner and Admin; the API decides again. `ownerUserId` null = nobody. */
export async function assignLeadAction(tenantId: string, leadId: string, ownerUserId: string | null): Promise<AssignResult> {
  const user = await requireUser();
  if (leadsScreens() === "off" || !isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId) || (ownerUserId !== null && !isCanonicalUuid(ownerUserId))) return { ok: false, error: "not_available" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  const out = await assignLead({ token: user.accessToken, tenantId, userId: user.id }, leadId, ownerUserId);
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/lead-desk`);
  return out;
}
