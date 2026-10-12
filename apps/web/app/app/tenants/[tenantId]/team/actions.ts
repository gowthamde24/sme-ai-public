"use server";

import { revalidatePath } from "next/cache";

import type { Out } from "@/components/v2/app/team/team-types";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { changeRole, createInvitation, removeMember, revokeInvitation, type Invitation, type NewInvitation, type Removed, type RoleChange } from "@/lib/api/team";
import { requireUser } from "@/lib/auth/session";

/**
 * The team, what the Owner and Admin do (job CC, screen 4). Each action checks its ids and values, asks the API with the person's own token (the API checks the role, the second factor and the rules about who may do what) and
 * answers the thing or one sentence of ours with the API's closed code. The new invitation's code goes back to the page that asked and nowhere else: it is not logged, and no page is revalidated with it.
 */
async function run<T>(tenantId: string, ids: string[], inputOk: boolean, work: (token: string) => Promise<T>): Promise<Out<T>> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!inputOk || !isCanonicalUuid(tenantId) || ids.some((i) => !isCanonicalUuid(i))) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    return { ok: true, data: await work(user.accessToken) };
  } catch (error) {
    return failureOf(error, t);
  }
}

export async function inviteAction(tenantId: string, invitationId: string, role: string, days: number, label: string): Promise<Out<NewInvitation>> {
  return run(tenantId, [invitationId], typeof label === "string" && label.length <= 60 && Number.isInteger(days), (token) => createInvitation(token, tenantId, { invitationId, role, days, label }));
}

export async function revokeInvitationAction(tenantId: string, invitationId: string): Promise<Out<Invitation>> {
  const out = await run(tenantId, [invitationId], true, (token) => revokeInvitation(token, tenantId, invitationId));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/team`);
  return out;
}

export async function changeRoleAction(tenantId: string, userId: string, role: string): Promise<Out<RoleChange>> {
  const out = await run(tenantId, [userId], true, (token) => changeRole(token, tenantId, userId, role));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/team`);
  return out;
}

export async function removeMemberAction(tenantId: string, userId: string, reason: string): Promise<Out<Removed>> {
  const out = await run(tenantId, [userId], true, (token) => removeMember(token, tenantId, userId, reason));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/team`);
  return out;
}
