import { notFound, redirect } from "next/navigation";

import { AddListForm } from "@/components/v2/app/lists/AddListForm";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { whatYouSellLists } from "@/lib/screens/flag";

import { createListAction } from "../../lists-actions";

export const metadata = { title: `Add a list · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /what-you-sell/lists/new (flag WHAT_YOU_SELL_LISTS; Owner and Admin): pick the kind, name the list. */
export default async function NewListPage({ params }: PageProps<"/app/tenants/[tenantId]/what-you-sell/lists/new">) {
  if (!whatYouSellLists()) notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  if (role !== "owner" && role !== "admin") notFound();
  const lang = await getLang();
  const words = wordsFor(lang, ["wls."]);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["wls.new.title"] ?? "Add a list"} sub={words["wls.new.sub"]} />
      <div className="mt-4">
        <AddListForm words={words} base={`/app/tenants/${tenantId}/what-you-sell`} create={createListAction.bind(null, tenantId)} />
      </div>
    </main>
  );
}
