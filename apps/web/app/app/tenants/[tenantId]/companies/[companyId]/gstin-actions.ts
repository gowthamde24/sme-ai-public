"use server";

import { revalidatePath } from "next/cache";

import type { Reply as Out } from "@/components/v2/app/cc/kit";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { setCompanyGstin } from "@/lib/api/gstin";
import { gstinProblem, normaliseGstin, stateOfGstin } from "@/lib/gstin";
import { requireUser } from "@/lib/auth/session";

/**
 * A business customer's GSTIN (job CC, screen 6): set it on the company or take it off. Owner, Admin and Sales (the API checks). Not well formed is refused here and again by the API and the database. A customer's GSTIN is
 * personal data of a sole proprietor (it holds their PAN): it is erased with the company.
 */
export async function saveCompanyGstinAction(tenantId: string, companyId: string, gstin: string | null): Promise<Out<{ gstin: string | null; state: string | null }>> {
  const user = await requireUser();
  const t = appT(await getLang());
  const clean = gstin === null ? null : normaliseGstin(String(gstin));
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(companyId) || (clean !== null && (clean === "" || gstinProblem(clean) !== null))) return { ok: false, kind: "invalid", error: t("apierr.invalid"), code: "validation_error" };
  try {
    const saved = await setCompanyGstin(user.accessToken, tenantId, companyId, clean);
    revalidatePath(`/app/tenants/${tenantId}/companies/${companyId}`);
    return { ok: true, data: { gstin: saved, state: saved ? stateOfGstin(saved) : null } };
  } catch (error) {
    return failureOf(error, t);
  }
}
