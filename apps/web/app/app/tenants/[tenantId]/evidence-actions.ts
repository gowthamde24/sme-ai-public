"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  createEvidence,
  type EvidenceTarget,
  validateEvidenceForm,
} from "@/lib/api/evidence";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";

export type EvidenceFormState = { error?: string } | undefined;

const TARGETS: readonly EvidenceTarget[] = ["companies", "leads"];

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Add evidence to a company or a lead. Bound on the server to the page's tenant, target kind and
 * target id (`addEvidenceAction.bind(null, tenantId, "companies", companyId)`).
 *
 * - The evidence id comes from the form (generated ONCE per render of the page), so submitting
 *   twice sends the same id and the API treats the second call as a retry (200, same item).
 * - Everything is re-validated here (the browser is not trusted) and again by the API and the
 *   database. The API sets the provider; the client cannot.
 * - Every failure becomes a short generic message. Raw API bodies and the submitted text (a URL or
 *   snippet can be personal data) are never shown, logged or echoed.
 * - The API still enforces the role; hiding the form for Viewers is a convenience.
 */
export async function addEvidenceAction(
  tenantId: string,
  target: EvidenceTarget,
  targetId: string,
  _prev: EvidenceFormState,
  formData: FormData,
): Promise<EvidenceFormState> {
  const t = await serverT(["ws."]);
  const user = await requireUser();

  if (
    !isCanonicalUuid(tenantId) ||
    !isCanonicalUuid(targetId) ||
    !TARGETS.includes(target)
  )
    return { error: t("ws.this_record_is_not_available") };
  const id = field(formData, "id");
  if (!isCanonicalUuid(id)) return { error: t("ws.reload_the_page_and_try_again") };

  const checked = validateEvidenceForm({
    kind: field(formData, "kind"),
    url: field(formData, "url"),
    reference: field(formData, "reference"),
    snippet: field(formData, "snippet"),
    publishedDate: field(formData, "published_at"),
  });
  if ("error" in checked) return { error: checked.error };

  try {
    await createEvidence(user.accessToken, tenantId, target, targetId, {
      id,
      ...checked.value,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.status === 403)
        return { error: t("ws.your_role_cannot_add_evidence") };
      if (error.status === 404)
        return { error: t("ws.this_record_is_not_available") };
      if (error.status === 409 && error.code === "archived")
        return {
          error: t("ws.this_record_is_archived_so_it"),
        };
      if (error.status === 409) {
        return {
          error:
            t("ws.that_form_was_already_used_for_2"),
        };
      }
      if (error.status === 422)
        return { error: t("ws.check_the_values_and_try_again") };
    }
    return { error: t("ws.could_not_save_the_evidence_try") };
  }

  const back = `/app/tenants/${tenantId}/${target}/${targetId}`;
  revalidatePath(back);
  redirect(`${back}?section=evidence`); // the part the form is in, so the new item is on screen (the company and lead pages show one part at a time)
}
