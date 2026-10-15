import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { sendMaterialsBusinessTo } from "@/lib/packs/materials-redirect";

import { addProductAction } from "./actions";
import { ProductForm } from "./product-form";
import { mutedText, pageH1, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2, CatalogueTabs } from "@/components/v2/app/parts";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Add a product · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ADMINS = ["owner", "admin"];

/**
 * /app/tenants/[tenantId]/products/new: add one product (a saree type). Owner or Admin. Server-side; requireUser() runs FIRST and every call goes to OUR API with the user's own token. Anyone else sees a
 * plain notice and the API is not asked anything for them; the API and the database enforce the role regardless.
 */
export default async function NewProductPage({ params }: PageProps<"/app/tenants/[tenantId]/products/new">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["prod."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  await sendMaterialsBusinessTo(user.accessToken, tenantId, "/catalogue/new");

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!ADMINS.includes(tenant.role))
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("prod.add_a_product")}</h1>
        <p>{t("prod.an_owner_or_an_admin_adds")}</p>
      </main>
    );
  // one id per render: a second press is a retry. The key remounts the form for the next product.
  const id = crypto.randomUUID();
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("prod.add_a_product")}</h1>
      <CatalogueTabs tenantId={tenantId} role={tenant.role} current="add-product" />
      <p className={mutedText}>{t("prod.a_product_is_a_saree_type")}</p>
      <ProductForm words={words} key={id} action={addProductAction.bind(null, tenantId)} tenantId={tenantId} id={id} />
    </main>
  );
}
