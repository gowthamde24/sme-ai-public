import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ListSettings } from "@/components/v2/app/lists/ListSettings";
import { ListView } from "@/components/v2/app/lists/ListView";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getList, getRows } from "@/lib/api/lists";
import { requireUser } from "@/lib/auth/session";
import { whatYouSellLists } from "@/lib/screens/flag";

import { loadRowsAction, removeListAction, removeRowAction, renameListAction, saveRowAction } from "../../lists-actions";

export const metadata = { title: `What you sell · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /what-you-sell/lists/[listId] (flag WHAT_YOU_SELL_LISTS): one list as a table: search, filters, sort, items. Everyone reads; Owner and Admin change; only the Owner changes a price. */
export default async function ListPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/what-you-sell/lists/[listId]">) {
  if (!whatYouSellLists()) notFound();
  const { tenantId, listId } = await params;
  const { new: isNew } = await searchParams;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(listId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  let list, page;
  try {
    [list, page] = await Promise.all([getList(user.accessToken, tenantId, listId), getRows(user.accessToken, tenantId, listId)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    throw error;
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["wls."]);
  const base = `/app/tenants/${tenantId}/what-you-sell`;
  return (
    <main className={pageMain} lang={lang}>
      <Link href={base} className="mb-1 inline-block py-1.5 text-[15px] font-semibold text-muted hover:text-ink">
        {words["wls.back"]}
      </Link>
      <PageTop title={list.name} sub={`${words[`wls.kind.${list.kind}`] ?? ""} · ${(words["wls.items"] ?? "{n} items").replace("{n}", String(list.rowCount))}`} />
      {isNew === "1" ? (
        <p role="status" className="m-0 mt-3 border-y border-line py-3 text-[15px] text-muted">
          {words["wls.new.starter"]}
        </p>
      ) : null}
      <div className="mt-4">
        <ListView
          list={list}
          initial={page}
          owner={role === "owner"}
          canEdit={role === "owner" || role === "admin"}
          words={words}
          base={`${base}/lists/${listId}`}
          actions={{ load: loadRowsAction.bind(null, tenantId, listId), save: saveRowAction.bind(null, tenantId, listId) as never, remove: removeRowAction.bind(null, tenantId, listId) }}
        />
      </div>
      {role === "owner" || role === "admin" ? <ListSettings list={list} words={words} base={base} rename={renameListAction.bind(null, tenantId, listId)} remove={removeListAction.bind(null, tenantId, listId)} /> : null}
    </main>
  );
}
