"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createProduct, MAX_CATEGORY, MAX_NAME, SKU_PATTERN, UNITS, type Unit } from "@/lib/api/products";
import { requireUser } from "@/lib/auth/session";
import { serverT } from "@/i18n/server-t";
import { makeT, type Say } from "@/components/v2/app/words";

export type ProductFormState = { ok?: boolean; error?: string; name?: string; sku?: string } | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. */
function describe(error: unknown, t: Say = makeT()): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return t("prod.your_role_cannot_add_products");
    if (error.status === 404) return t("prod.this_workspace_is_not_available");
    if (error.status === 409) return t("prod.that_code_is_already_used_by");
    if (error.status === 422) return t("prod.check_the_values_and_try_again");
  }
  return t("prod.could_not_save_the_product_try");
}

/** Add one product (a saree type) to the catalog. The id comes from the page, so a second press is a retry. No price is set here: prices are typed for each quote, or loaded on the price-list page. */
export async function addProductAction(tenantId: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const t = await serverT(["prod."]);
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: t("prod.this_workspace_is_not_available") };
  const id = field(formData, "id");
  if (!isCanonicalUuid(id)) return { ok: false, error: t("prod.this_form_is_out_of_date") };
  const sku = field(formData, "sku");
  const name = field(formData, "name");
  const unit = field(formData, "unit") as Unit;
  const category = field(formData, "category");
  if (!SKU_PATTERN.test(sku)) return { ok: false, error: t("prod.the_code_may_use_letters_digits") };
  if (name.length < 1 || name.length > MAX_NAME) return { ok: false, error: t("prod.enter_a_name_up_to_200") };
  if (!UNITS.includes(unit)) return { ok: false, error: t("prod.choose_piece_or_set") };
  if (category.length > MAX_CATEGORY) return { ok: false, error: t("prod.the_category_is_too_long_up") };
  try {
    await createProduct(user.accessToken, tenantId, { id, sku, name, unit, category: category === "" ? null : category });
  } catch (error) {
    return { ok: false, error: describe(error, t) };
  }
  revalidatePath(`/app/tenants/${tenantId}`);
  revalidatePath(`/app/tenants/${tenantId}/products/new`);
  return { ok: true, name, sku };
}
