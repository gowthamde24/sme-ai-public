import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ItemEditor } from "@/components/v2/app/catalogue/ItemEditor";
import type { EditorActions } from "@/components/v2/app/catalogue/catalogue-types";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { removePhotoAction, reorderPhotosAction, saveItemAction, saveItemCustomAction } from "../catalogue-actions";
import { catalogueWords } from "../catalogue-words";
import { partsWords } from "@/i18n/app-words";
import { formFields } from "@/lib/packs/form-fields";
import { listCustomFields } from "@/lib/api/custom-fields";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Add a saree · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/catalogue/new: add a saree (Owner and Admin; anyone else goes to the catalogue). The page makes the saree's id, so pressing Save twice is a retry and never a second saree. */
export default async function NewCatalogueItemPage({ params }: PageProps<"/app/tenants/[tenantId]/catalogue/new">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const base = `/app/tenants/${tenantId}`;
  if (hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials")) redirect(`/app/tenants/${tenantId}/materials/new`);
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(`${base}/catalogue`);
  const lang = await getLang();
  const t = appT(lang);
  const itemId = randomUUID();
  // the extra fields of the business (job CL): drawn only when the server can list them
  const fields = formFields(await listCustomFields(user.accessToken, tenantId, "catalogue_item").catch((e) => (e instanceof ApiAuthError ? redirect("/login") : [])), "catalogue_item", lang);
  const actions: EditorActions = { ...(fields.length > 0 ? { saveCustom: saveItemCustomAction.bind(null, tenantId) } : {}), save: saveItemAction.bind(null, tenantId), remove: removePhotoAction.bind(null, tenantId), reorder: reorderPhotosAction.bind(null, tenantId) };
  return (
    <main className={pageMain} lang={lang}>
      <p>
        <Link href={`${base}/catalogue`} className={backLink}>
          ← {t("catalogue.item.back")}
        </Link>
      </p>
      <h1 className="mb-4 mt-2 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{t("catalogue.new.title")}</h1>
      <ItemEditor base={base} itemId={itemId} item={null} role={tenant.role} words={catalogueWords(lang)} actions={actions} fields={fields} uploadUrl={`${base}/catalogue/${itemId}/photos`} />
    </main>
  );
}
