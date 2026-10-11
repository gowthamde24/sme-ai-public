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
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { removePhotoAction, reorderPhotosAction, saveItemAction } from "../catalogue-actions";
import { catalogueWords } from "../catalogue-words";

export const metadata = { title: "Add a saree · SME AI Revenue Engine" };
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
    return <ApiDownV2 />;
  }
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role !== "owner" && tenant.role !== "admin") redirect(`${base}/catalogue`);
  const lang = await getLang();
  const t = appT(lang);
  const itemId = randomUUID();
  const actions: EditorActions = { save: saveItemAction.bind(null, tenantId), remove: removePhotoAction.bind(null, tenantId), reorder: reorderPhotosAction.bind(null, tenantId) };
  return (
    <main className={pageMain} lang={lang}>
      <p>
        <Link href={`${base}/catalogue`} className={backLink}>
          ← {t("catalogue.item.back")}
        </Link>
      </p>
      <h1 className="mb-4 mt-2 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{t("catalogue.new.title")}</h1>
      <ItemEditor base={base} itemId={itemId} item={null} role={tenant.role} words={catalogueWords(lang)} actions={actions} uploadUrl={`${base}/catalogue/${itemId}/photos`} />
    </main>
  );
}
