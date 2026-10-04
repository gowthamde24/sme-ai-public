"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { createCompany, isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

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
  const user = await requireUser();

  const id = field(formData, "id");
  const name = field(formData, "name");
  const type = field(formData, "type") || "prospect";
  const website = field(formData, "website");
  const country = field(formData, "country");
  const city = field(formData, "city");
  const industry = field(formData, "industry");

  if (!isCanonicalUuid(tenantId))
    return { error: "This workspace is not available." };
  if (!isCanonicalUuid(id)) return { error: "Reload the page and try again." };
  if (name.length < 1 || name.length > 200) {
    return { error: "Enter a company name (up to 200 characters)." };
  }
  if (!(TYPES as readonly string[]).includes(type)) {
    return { error: "Choose a company type." };
  }
  if (
    website.length > 200 ||
    [country, city, industry].some((v) => v.length > 100)
  ) {
    return { error: "One of the values is too long." };
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
        return { error: "Your role cannot create companies." };
      if (error.status === 404)
        return { error: "This workspace is not available." };
      if (error.status === 409) {
        return {
          error:
            "That form was already used for a different company. Reload the page and try again.",
        };
      }
      if (error.status === 422)
        return { error: "Check the values and try again." };
    }
    return { error: "Could not save the company. Try again." };
  }

  revalidatePath(`/app/tenants/${tenantId}`);
  redirect(`/app/tenants/${tenantId}?tab=companies`);
}
