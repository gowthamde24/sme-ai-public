"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { addDnc, removeDnc } from "@/lib/api/do-not-call";
import { indianMobile, type DncEntry } from "@/lib/jobs/dnc";

import { DECIDERS, invalid, refusal, who } from "../retailers/finder-guard";

/** "Add" a number to the Do-Not-Call list (JOBS): Owner and Admin. The number is checked here (an Indian mobile number) before anything is sent; the API answers with the masked entry. */
export async function addDncAction(tenantId: string, phone: string): Promise<Reply<DncEntry>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof phone !== "string" || phone.length > 40 || indianMobile(phone) === null) return invalid(ctx.t, "jobs.dnc.err.phone");
  try {
    const data = await addDnc(ctx.token, tenantId, phone);
    revalidatePath(`/app/tenants/${tenantId}/do-not-call`);
    return { ok: true, data };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/** Take a number off the list: the OWNER only (a number leaves the list only when the owner removes it and the person has asked). */
export async function removeDncAction(tenantId: string, id: string): Promise<Reply<{ id: string }>> {
  const ctx = await who(tenantId, ["owner"]);
  if ("ok" in ctx) return ctx;
  if (typeof id !== "string" || !isCanonicalUuid(id)) return invalid(ctx.t);
  try {
    await removeDnc(ctx.token, tenantId, id);
    revalidatePath(`/app/tenants/${tenantId}/do-not-call`);
    return { ok: true, data: { id } };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}
