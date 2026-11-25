import { notFound, redirect } from "next/navigation";

import { ColumnsEditor } from "@/components/v2/app/lists/ColumnsEditor";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getList } from "@/lib/api/lists";
import { requireUser } from "@/lib/auth/session";
import { whatYouSellLists } from "@/lib/screens/flag";

import { saveColumnsAction } from "../../../lists-actions";

export const metadata = { title: `Edit columns · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /what-you-sell/lists/[listId]/columns (flag WHAT_YOU_SELL_LISTS; Owner and Admin): the columns of one list. */
export default async function ColumnsPage({ params }: PageProps<"/app/tenants/[tenantId]/what-you-sell/lists/[listId]/columns">) {
  if (!whatYouSellLists()) notFound();
  const { tenantId, listId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(listId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  if (role !== "owner" && role !== "admin") notFound();
  let list;
  try {
    list = await getList(user.accessToken, tenantId, listId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    throw error;
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["wls."]);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["wls.cols.title"] ?? "Edit columns"} sub={list.name} />
      <div className="mt-4">
        <ColumnsEditor list={list} words={words} back={`/app/tenants/${tenantId}/what-you-sell/lists/${listId}`} save={saveColumnsAction.bind(null, tenantId, listId)} />
      </div>
    </main>
  );
}
