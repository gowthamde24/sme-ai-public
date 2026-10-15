"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Outcome, SaveInput } from "@/components/v2/app/materials/ProductEditor";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { listCustomFields, putCatalogueCustom } from "@/lib/api/custom-fields";
import { AREA_UNITS, SELL_UNITS, STOCK_STATUSES, putMaterialItem, removeMaterialPhoto, reorderMaterialPhotos, type MaterialItemInput } from "@/lib/api/materials";
import { normaliseValues } from "@/lib/packs/field-values";
import { requireUser } from "@/lib/auth/session";

import { refusalOf, type Context } from "../catalogue/catalogue-refusals";

const MAX_NAME = 120;
const MIN_PRICE_PAISE = 100;
const MAX_PRICE_PAISE = 100_000_000;

async function context() {
  const user = await requireUser();
  const lang = await getLang();
  return { user, t: appT(lang) };
}
type Ctx = Awaited<ReturnType<typeof context>>;

/** A refusal as OUR sentence. A rejected session goes to sign-in. */
function refused(error: unknown, t: Ctx["t"], ctx: Context = "save"): Extract<Outcome, { ok: false }> {
  try {
    const r = refusalOf(error, ctx);
    return { ok: false, error: t(r.key as "today.err.generic"), ...(r.mfa ? { mfa: true } : {}), ...(r.stale ? { stale: true } : {}) };
  } catch (e) {
    if (e instanceof ApiAuthError) redirect("/login");
    throw e;
  }
}

const refresh = (tenantId: string, itemId?: string) => {
  revalidatePath(`/app/tenants/${tenantId}/materials`);
  if (itemId) revalidatePath(`/app/tenants/${tenantId}/materials/${itemId}`);
};

/** Create or change a product (Owner, Admin). The id is the page's, so a second press is a retry. The exact price rides along only when the Owner's form sends it (Owner with the second factor; the API refuses anyone else). */
export async function saveMaterialAction(tenantId: string, itemId: string, input: SaveInput): Promise<Outcome> {
  const { user, t } = await context();
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const ok =
    isCanonicalUuid(tenantId) && isCanonicalUuid(itemId) && name.length >= 1 && name.length <= MAX_NAME && (SELL_UNITS as readonly string[]).includes(input.sellUnit) &&
    (input.areaUnit === null || (AREA_UNITS as readonly string[]).includes(input.areaUnit)) && (STOCK_STATUSES as readonly string[]).includes(input.stockStatus) && typeof input.active === "boolean";
  if (!ok) return { ok: false, error: t("mat.err.invalid") };
  let price: MaterialItemInput["price"];
  if (input.price !== undefined) {
    if ("clear" in input.price) {
      if (input.price.clear !== true) return { ok: false, error: t("mat.err.invalid") };
      price = { clear: true };
    } else {
      const paise = Math.round(Number(input.price.rupees) * 100);
      if (!Number.isFinite(paise) || paise < MIN_PRICE_PAISE || paise > MAX_PRICE_PAISE) return { ok: false, error: t("mat.err.price") };
      price = { paise };
    }
  }
  try {
    const { item } = await putMaterialItem(user.accessToken, tenantId, itemId, { name, sellUnit: input.sellUnit, areaUnit: input.areaUnit, stockStatus: input.stockStatus, active: input.active, ...(price ? { price } : {}) });
    refresh(tenantId, itemId);
    return { ok: true, item };
  } catch (error) {
    return refused(error, t, price ? "price" : "save");
  }
}

/** Take a photo off its product. The last photo of a product that is shown cannot go. */
export async function removeMaterialPhotoAction(tenantId: string, photoId: string): Promise<Outcome> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(photoId)) return { ok: false, error: t("today.err.state"), stale: true };
  try {
    const item = await removeMaterialPhoto(user.accessToken, tenantId, photoId);
    refresh(tenantId, item.id);
    return { ok: true, item };
  } catch (error) {
    return refused(error, t, "remove");
  }
}

/** Put the product's photos in a new order; the first is the cover. Every live photo exactly once. */
export async function reorderMaterialPhotosAction(tenantId: string, itemId: string, photoIds: string[]): Promise<Outcome> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId) || !Array.isArray(photoIds) || photoIds.length < 1 || photoIds.length > 8 || !photoIds.every(isCanonicalUuid) || new Set(photoIds).size !== photoIds.length) return { ok: false, error: t("mat.err.invalid") };
  try {
    const item = await reorderMaterialPhotos(user.accessToken, tenantId, itemId, photoIds);
    refresh(tenantId, itemId);
    return { ok: true, item };
  } catch (error) {
    return refused(error, t);
  }
}

/** The extra details of the business type for one product (GST rate, HSN, pieces per area ...): checked against the workspace's field definitions, then kept with `PUT .../catalogue/{id}/custom`. Our sentences only. */
export async function saveMaterialCustomAction(tenantId: string, itemId: string, values: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, t } = await context();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId)) return { ok: false, error: t("mat.err.invalid") };
  let defs;
  try {
    defs = await listCustomFields(user.accessToken, tenantId, "catalogue_item");
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: t("fields.form.unsaved", { reason: t("fields.form.reason.unavailable") }) };
  }
  const { values: clean, issues } = normaliseValues(defs, "catalogue_item", values);
  const bad = Object.entries(issues)[0];
  if (bad) return { ok: false, error: `${defs.find((f) => f.code === bad[0])?.label.en ?? bad[0]} ${t(`fields.issue.${bad[1]}` as "fields.issue.required")}` };
  if (Object.keys(clean).length === 0) return { ok: true };
  try {
    await putCatalogueCustom(user.accessToken, tenantId, itemId, clean);
    refresh(tenantId, itemId);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    const reason = error instanceof ApiRequestError && (error.status === 404 || error.status === 501 || error.code === "module_off") ? "unavailable" : error instanceof ApiRequestError && (error.status === 400 || error.status === 409 || error.status === 422) ? "invalid" : "failed";
    return { ok: false, error: t("fields.form.unsaved", { reason: t(`fields.form.reason.${reason}` as "fields.form.reason.failed") }) };
  }
}
