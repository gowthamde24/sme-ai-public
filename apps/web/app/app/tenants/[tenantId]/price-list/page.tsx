import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { commitPriceListAction, previewPriceListAction } from "./price-list-actions";
import { PriceListImport } from "./price-list-import";
import { mutedText, noteBox, pageH1, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2, CatalogueTabs } from "@/components/v2/app/parts";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Price list · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** Today's date in India: the default day a new price list starts. */
function todayInIndia(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * /app/tenants/[tenantId]/price-list: load a price list from a CSV file (owner or admin). Server-side only; requireUser() runs FIRST and every call goes to OUR API with the user's own token.
 * Anyone else sees a plain notice and nothing is asked of the API for them.
 */
export default async function PriceListPage({ params }: PageProps<"/app/tenants/[tenantId]/price-list">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["pl."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (tenant.role !== "owner" && tenant.role !== "admin")
    return (
      <main className={pageMain} lang={lang}>
        <h1 className={pageH1}>{t("pl.price_list")}</h1>
        <p className={mutedText}>{t("pl.an_owner_or_admin_loads_the")}</p>
      </main>
    );
  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("pl.load_a_price_list")}</h1>
      <CatalogueTabs tenantId={tenantId} role={tenant.role} current="price-list" />
      <p role="note" className={noteBox}>
        {t("pl.a_price_list_is_a_file")}
      </p>
      <PriceListImport words={words}
        preview={previewPriceListAction.bind(null, tenantId)}
        commit={commitPriceListAction.bind(null, tenantId)}
        today={todayInIndia(new Date())}
        secondFactorMissing={user.aal !== "aal2"}
      />
    </main>
  );
}
