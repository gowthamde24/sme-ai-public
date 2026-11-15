import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { sendMaterialsBusinessTo } from "@/lib/packs/materials-redirect";

import { commitPriceListAction, previewPriceListAction } from "./price-list-actions";
import { PriceListImport } from "./price-list-import";
import { mutedText, noteBox, pageH1, pageMain } from "@/components/v2/app/ui";
import { PriceRanges } from "../item-types/price-ranges";
import { sectionH2First } from "../item-types/section-h2";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { BRAND_NAME } from "@/design/brand";
import { secondFactorNeeded } from "@/lib/auth/second-factor";

export const metadata = { title: `Price lists · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** Today's date in India: the default day a new price list starts. */
function todayInIndia(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * /app/tenants/[tenantId]/price-list: the "Price lists" tab (owner, 15 Nov 2026: one row of tabs, Products | Price lists). On top: load a price list from a CSV file (owner or admin); under it the section "Price ranges" (the
 * item types with their lowest and highest price). Server-side only; requireUser() runs FIRST and every call goes to OUR API with the user's own token. A sales user reads the price ranges and is asked nothing else; a viewer
 * sees a plain notice and nothing is asked of the API for them.
 */
export default async function PriceListPage({ params }: PageProps<"/app/tenants/[tenantId]/price-list">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["pl.", "it.", "qp."], ["nav.item.catalogue"]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  await sendMaterialsBusinessTo(user.accessToken, tenantId, "/catalogue");

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const admin = tenant.role === "owner" || tenant.role === "admin";
  if (!admin && tenant.role !== "sales")
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("nav.item.catalogue")}</h1>
        <p className={mutedText}>{t("pl.an_owner_or_admin_loads_the")}</p>
      </main>
    );
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("nav.item.catalogue")}</h1>
      <section aria-labelledby="price-list-heading" data-part="load-price-list">
        <h2 id="price-list-heading" className={sectionH2First}>
          {t("pl.load_a_price_list")}
        </h2>
        {admin ? (
          <>
            <p role="note" className={noteBox}>
              {t("pl.a_price_list_is_a_file")}
            </p>
            <PriceListImport words={words}
              preview={previewPriceListAction.bind(null, tenantId)}
              commit={commitPriceListAction.bind(null, tenantId)}
              today={todayInIndia(new Date())}
              secondFactorMissing={secondFactorNeeded(user)}
            />
          </>
        ) : (
          <p className={mutedText}>{t("pl.an_owner_or_admin_loads_the")}</p>
        )}
        {/* the API has no read of the price list in force yet (only import preview and import): said honestly, not drawn as an empty table */}
        <p className={`${mutedText} mt-3`} data-part="loaded-list">
          {t("pl.loaded_soon")}
        </p>
      </section>
      {await PriceRanges({ accessToken: user.accessToken, tenantId, role: tenant.role, secondFactorMissing: secondFactorNeeded(user), words })}
    </main>
  );
}
