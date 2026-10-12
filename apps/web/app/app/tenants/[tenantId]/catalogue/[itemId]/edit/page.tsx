import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ItemEditor } from "@/components/v2/app/catalogue/ItemEditor";
import type { EditorActions } from "@/components/v2/app/catalogue/catalogue-types";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { getCatalogueItem } from "@/lib/api/catalogue";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { removePhotoAction, reorderPhotosAction, saveItemAction } from "../../catalogue-actions";
import { catalogueWords } from "../../catalogue-words";
import { partsWords } from "@/i18n/app-words";

export const metadata = { title: "Edit a saree · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/catalogue/[itemId]/edit: change a saree and its photos (Owner and Admin; anyone else is sent to the saree's page). */
export default async function EditCatalogueItemPage({ params }: PageProps<"/app/tenants/[tenantId]/catalogue/[itemId]/edit">) {
  const user = await requireUser();
  const { tenantId, itemId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId)) notFound();
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
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(`${base}/catalogue/${itemId}`);
  let item;
  try {
    item = await getCatalogueItem(user.accessToken, tenantId, itemId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  const actions: EditorActions = { save: saveItemAction.bind(null, tenantId), remove: removePhotoAction.bind(null, tenantId), reorder: reorderPhotosAction.bind(null, tenantId) };
  return (
    <main className={pageMain} lang={lang}>
      <p>
        <Link href={`${base}/catalogue/${itemId}`} className={backLink}>
          ← {item.name}
        </Link>
      </p>
      <h1 className="mb-4 mt-2 font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{t("catalogue.edit.title", { name: item.name })}</h1>
      <ItemEditor base={base} itemId={itemId} item={item} role={tenant.role} words={catalogueWords(lang)} actions={actions} uploadUrl={`${base}/catalogue/${itemId}/photos`} />
    </main>
  );
}
