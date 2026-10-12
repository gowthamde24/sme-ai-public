"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { createCompany, isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";

export type CompanyFormState = { error?: string } | undefined;

const TYPES = ["prospect", "customer", "supplier", "other"] as const;
type CompanyType = (typeof TYPES)[number];

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Create a company. Bound to the tenant of the page (`createCompanyAction.bind(null, tenantId)`).
 *
 * - The row id comes from the form (generated ONCE per render of the page), so submitting twice
 *   sends the same id and the API treats the second call as a retry (200, same row).
 * - Every API failure becomes a short generic message. Raw API bodies/messages are never shown.
 * - The API still enforces the role; hiding the form for Viewers is a convenience.
 */
export async function createCompanyAction(
  tenantId: string,
  _prev: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const t = await serverT(["ws."]);
  const user = await requireUser();

  const id = field(formData, "id");
  const name = field(formData, "name");
  const type = field(formData, "type") || "prospect";
  const website = field(formData, "website");
  const country = field(formData, "country");
  const city = field(formData, "city");
  const industry = field(formData, "industry");

  if (!isCanonicalUuid(tenantId))
    return { error: t("ws.this_workspace_is_not_available") };
  if (!isCanonicalUuid(id)) return { error: t("ws.reload_the_page_and_try_again") };
  if (name.length < 1 || name.length > 200) {
    return { error: t("ws.enter_a_company_name_up_to") };
  }
  if (!(TYPES as readonly string[]).includes(type)) {
    return { error: t("ws.choose_a_company_type") };
  }
  if (
    website.length > 200 ||
    [country, city, industry].some((v) => v.length > 100)
  ) {
    return { error: t("ws.one_of_the_values_is_too") };
  }

  try {
    await createCompany(user.accessToken, tenantId, {
      id,
      name,
      type: type as CompanyType,
      ...(website && { website }),
      ...(country && { country }),
      ...(city && { city }),
      ...(industry && { industry }),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError) {
      if (error.status === 403)
        return { error: t("ws.your_role_cannot_create_companies") };
      if (error.status === 404)
        return { error: t("ws.this_workspace_is_not_available") };
      if (error.status === 409) {
        return {
          error:
            t("ws.that_form_was_already_used_for"),
        };
      }
      if (error.status === 422)
        return { error: t("ws.check_the_values_and_try_again") };
    }
    return { error: t("ws.could_not_save_the_company_try") };
  }

  revalidatePath(`/app/tenants/${tenantId}`);
  redirect(`/app/tenants/${tenantId}?tab=companies`);
}
