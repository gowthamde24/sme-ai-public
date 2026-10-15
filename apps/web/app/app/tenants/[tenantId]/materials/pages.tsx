import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ProductEditor, type EditorActions } from "@/components/v2/app/materials/ProductEditor";
import { ProductView } from "@/components/v2/app/materials/ProductView";
import { ProductsView } from "@/components/v2/app/materials/ProductsView";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, type fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { getCatalogueCustom, listCustomFields } from "@/lib/api/custom-fields";
import { getMaterialItem, listMaterialItems } from "@/lib/api/materials";
import { formFields } from "@/lib/packs/form-fields";

import { materialWords } from "./words";
import { removeMaterialPhotoAction, reorderMaterialPhotosAction, saveMaterialAction, saveMaterialCustomAction } from "./actions";

type Tenant = Awaited<ReturnType<typeof fetchTenant>>;
type Who = { accessToken: string; tenantId: string; tenant: Tenant };
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_CURSOR = 400;

/** The product list of a business that sells building materials (job CO). */
export async function MaterialProductsPage({ accessToken, tenantId, tenant, raw }: Who & { raw: Record<string, string | string[] | undefined> }) {
  const lang = await getLang();
  const admin = tenant.role === "owner" || tenant.role === "admin";
  const rawAfter = pick(raw.after);
  const after = rawAfter && rawAfter.length <= MAX_CURSOR ? rawAfter : null;
  const inStock = pick(raw.stock) === "1";
  let page: Awaited<ReturnType<typeof listMaterialItems>> | null = null;
  try {
    page = await listMaterialItems(accessToken, tenantId, { inStock, includeInactive: admin, after });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <ProductsView base={`/app/tenants/${tenantId}`} words={materialWords(lang)} role={tenant.role} items={page?.items ?? null} more={page?.next_cursor ?? null} inStockOnly={inStock} />
    </main>
  );
}

/** One product (job CO). A hidden product is for the owner and admins only. */
export async function MaterialProductPage({ accessToken, tenantId, tenant, itemId, raw }: Who & { itemId: string; raw: Record<string, string | string[] | undefined> }) {
  const admin = tenant.role === "owner" || tenant.role === "admin";
  let item;
  try {
    item = await getMaterialItem(accessToken, tenantId, itemId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!item.active && !admin) notFound();
  const lang = await getLang();
  const fields = formFields(await listCustomFields(accessToken, tenantId, "catalogue_item").catch((e) => (e instanceof ApiAuthError ? redirect("/login") : [])), "catalogue_item", lang);
  const custom = fields.length > 0 ? await getCatalogueCustom(accessToken, tenantId, itemId).catch(() => ({})) : {};
  return (
    <main className={pageMain} lang={lang}>
      <ProductView base={`/app/tenants/${tenantId}`} item={item} role={tenant.role} words={materialWords(lang)} fields={fields} custom={custom} saved={pick(raw.saved) === "1"} />
    </main>
  );
}

/** Add or change a product (Owner and Admin; anyone else goes to the list or the product). For a new product the page makes the id, so pressing Save twice is a retry. */
export async function MaterialProductEditPage({ accessToken, tenantId, tenant, itemId }: Who & { itemId: string | null }) {
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(itemId ? `${base}/materials/${itemId}` : `${base}/materials`);
  let item = null;
  if (itemId) {
    try {
      item = await getMaterialItem(accessToken, tenantId, itemId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
      escalate(error);
      return <ApiDownV2 words={await partsWords()} />;
    }
  }
  const lang = await getLang();
  const t = appT(lang);
  const id = itemId ?? randomUUID();
  const fields = formFields(await listCustomFields(accessToken, tenantId, "catalogue_item").catch((e) => (e instanceof ApiAuthError ? redirect("/login") : [])), "catalogue_item", lang);
  const custom = itemId && fields.length > 0 ? await getCatalogueCustom(accessToken, tenantId, itemId).catch(() => ({})) : {};
  const actions: EditorActions = { ...(fields.length > 0 ? { saveCustom: saveMaterialCustomAction.bind(null, tenantId) } : {}), save: saveMaterialAction.bind(null, tenantId), remove: removeMaterialPhotoAction.bind(null, tenantId), reorder: reorderMaterialPhotosAction.bind(null, tenantId) };
  return (
    <main className={pageMain} lang={lang}>
      <p>
        <Link href={item ? `${base}/materials/${id}` : `${base}/materials`} className={backLink}>
          ← {item ? item.name : t("catalogue.item.back")}
        </Link>
      </p>
      <h1 className="mb-4 mt-2 font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{item ? t("mat.edit.title", { name: item.name }) : t("mat.new.title")}</h1>
      <ProductEditor base={base} itemId={id} item={item} role={tenant.role} words={materialWords(lang)} actions={actions} fields={fields} custom={custom} uploadUrl={`${base}/materials/${id}/photos`} />
    </main>
  );
}
