"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { PolicyBody } from "@contracts";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { saveMaterialPolicy } from "@/lib/api/materials";
import { requireUser } from "@/lib/auth/session";
import { policyFromForm, formFromPolicy } from "@/components/v2/app/materials/policy-logic";

import { materialRefusalOf } from "../quotes/material-refusals";

/**
 * Keep the quote rules as a NEW version that applies from today (the Owner, with the second factor; the API refuses anyone else). The body is read again through the same checks the form used, so a hand-made request
 * cannot slip in a number the form would have refused. The same `versionId` is a retry. Our sentences only.
 */
export async function saveMaterialPolicyAction(tenantId: string, versionId: string, policy: PolicyBody): Promise<{ ok: true } | { ok: false; error: string; mfa?: boolean }> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(versionId) || typeof policy !== "object" || policy === null) return { ok: false, error: t("mat.err.invalid") };
  const checked = policyFromForm(formFromPolicy(policy));
  if (!checked.ok) return { ok: false, error: t("mat.err.invalid") };
  try {
    await saveMaterialPolicy(user.accessToken, tenantId, versionId, checked.policy);
    revalidatePath(`/app/tenants/${tenantId}/quote-policy`);
    return { ok: true };
  } catch (error) {
    try {
      const r = materialRefusalOf(error);
      return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}) };
    } catch (e) {
      if (e instanceof ApiAuthError) redirect("/login");
      throw e;
    }
  }
}
