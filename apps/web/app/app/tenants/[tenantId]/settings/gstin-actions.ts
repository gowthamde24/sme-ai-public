"use server";

import { revalidatePath } from "next/cache";

import type { Reply as Out } from "@/components/v2/app/cc/kit";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { putBusinessProfile } from "@/lib/api/gstin";
import { gstinProblem, normaliseGstin } from "@/lib/gstin";
import { requireUser } from "@/lib/auth/session";

/**
 * The shop's own GSTIN (job CC, screen 6): set it or take it off. Owner and Admin, with the second factor (the API checks). A number that is not well formed is refused here and again by the API and the database; the plain 15
 * characters are sent. `null` (or nothing typed) removes it.
 */
export async function saveShopGstinAction(tenantId: string, gstin: string | null): Promise<Out<{ gstin: string | null; state: string | null }>> {
  const user = await requireUser();
  const t = appT(await getLang());
  const clean = gstin === null ? null : normaliseGstin(String(gstin));
  if (!isCanonicalUuid(tenantId) || (clean !== null && (clean === "" || gstinProblem(clean) !== null))) return { ok: false, kind: "invalid", error: t("apierr.invalid"), code: "validation_error" };
  try {
    const profile = await putBusinessProfile(user.accessToken, tenantId, clean);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, data: profile };
  } catch (error) {
    return failureOf(error, t);
  }
}
