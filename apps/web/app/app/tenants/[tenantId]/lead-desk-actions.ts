"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { assignLead, fixLead, type AssignResult, type FixResult } from "@/lib/lead-desk/leads-source";
import { FIX_FIELDS, URGENCIES, type FixField } from "@/lib/lead-desk/profile";
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

/** "That is right" / "Change it" on a guessed field of a lead (job context-and-easy-sources B3): the Owner, Admin and Sales fix it; the API decides again. The field and the value are checked here too. */
export async function fixLeadFieldAction(tenantId: string, leadId: string, field: string, value: string | null): Promise<FixResult> {
  const user = await requireUser();
  const text = value === null ? null : value.trim().slice(0, 200);
  const known = (FIX_FIELDS as readonly string[]).includes(field);
  if (leadsScreens() === "off" || !known || !isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) return { ok: false, error: "not_available" };
  if (field === "urgency" ? text !== null && !(URGENCIES as readonly string[]).includes(text) : text === "") return { ok: false, error: "invalid" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (!["owner", "admin", "sales"].includes(tenant.role)) return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  const out = await fixLead({ token: user.accessToken, tenantId, userId: user.id }, leadId, field as FixField, text);
  if (out.ok) {
    revalidatePath(`/app/tenants/${tenantId}/lead-desk`);
    revalidatePath(`/app/tenants/${tenantId}/leads/${leadId}`);
  }
  return out;
}
