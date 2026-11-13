"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { approveStep, releaseNumber, requestNumber, type Moved } from "@/lib/phone-number/source";
import type { PhoneNumber } from "@/lib/phone-number/types";

/** The moves of Settings > Phone number (job B6; the TEST screen). Only the Owner changes anything; the answer is the new state or a sentence in the person's language, never an API text. Nothing is bought, rented or rung. */
export type Answer = { ok: true; data: PhoneNumber; message?: string } | { ok: false; error: string };

async function owner(tenantId: string): Promise<boolean> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return false;
  try {
    return (await fetchTenant(user.accessToken, tenantId)).role === "owner";
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return false;
  }
}

async function run(tenantId: string, move: () => Promise<Moved>, message?: string): Promise<Answer> {
  const t = appT(await getLang());
  if (!(await owner(tenantId))) return { ok: false, error: t("phone.owneronly") };
  const out = await move();
  if (!out.ok) return { ok: false, error: t(out.error === "state" ? "phone.err.state" : out.error === "not_available" ? "phone.unavailable" : "phone.err.generic") };
  revalidatePath(`/app/tenants/${tenantId}/phone-number`);
  return { ok: true, data: out.data, ...(message ? { message: t(message as "phone.released") } : {}) };
}

export async function requestNumberAction(tenantId: string, city: unknown): Promise<Answer> {
  return run(tenantId, () => requestNumber(city));
}
export async function approveStepAction(tenantId: string, step: unknown): Promise<Answer> {
  return run(tenantId, () => approveStep(step));
}
export async function releaseNumberAction(tenantId: string): Promise<Answer> {
  return run(tenantId, () => releaseNumber(), "phone.released");
}
