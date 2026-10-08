"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { createProduct, MAX_CATEGORY, MAX_NAME, SKU_PATTERN, UNITS, type Unit } from "@/lib/api/products";
import { requireUser } from "@/lib/auth/session";

export type ProductFormState = { ok?: boolean; error?: string; name?: string; sku?: string } | undefined;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Every failure becomes a short sentence of OUR wording; nothing the API, the database or the form said is echoed. */
function describe(error: unknown): string {
  if (error instanceof ApiAuthError) redirect("/login");
  if (error instanceof ApiRequestError) {
    if (error.status === 403) return "Your role cannot add products.";
    if (error.status === 404) return "This workspace is not available.";
    if (error.status === 409) return "That code is already used by another product, or this form was already used. Change the code or reload the page.";
    if (error.status === 422) return "Check the values and try again.";
  }
  return "Could not save the product. Try again.";
}

/** Add one product (a saree type) to the catalog. The id comes from the page, so a second press is a retry. No price is set here: prices are typed for each quote, or loaded on the price-list page. */
export async function addProductAction(tenantId: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "This workspace is not available." };
  const id = field(formData, "id");
  if (!isCanonicalUuid(id)) return { ok: false, error: "This form is out of date. Reload the page and try again." };
  const sku = field(formData, "sku");
  const name = field(formData, "name");
  const unit = field(formData, "unit") as Unit;
  const category = field(formData, "category");
  if (!SKU_PATTERN.test(sku)) return { ok: false, error: "The code may use letters, digits, dot, underscore and hyphen only (40 at most), and must not start with a hyphen." };
  if (name.length < 1 || name.length > MAX_NAME) return { ok: false, error: "Enter a name (up to 200 characters)." };
  if (!UNITS.includes(unit)) return { ok: false, error: "Choose Piece or Set." };
  if (category.length > MAX_CATEGORY) return { ok: false, error: "The category is too long (up to 64 characters)." };
  try {
    await createProduct(user.accessToken, tenantId, { id, sku, name, unit, category: category === "" ? null : category });
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
  revalidatePath(`/app/tenants/${tenantId}`);
  revalidatePath(`/app/tenants/${tenantId}/products/new`);
  return { ok: true, name, sku };
}
