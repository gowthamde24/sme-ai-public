import { notFound, redirect } from "next/navigation";

import { DuesView } from "@/components/v2/app/ledger/DuesView";
import { ApiDownV2, NotShownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getLedgerSummary } from "@/lib/api/ledger";
import { requireUser } from "@/lib/auth/session";

import { dueWords } from "./due-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Dues · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_CURSOR = 400;

/** /app/tenants/[tenantId]/dues: what customers owe (job CO; module `dues`, which the module guard of the workspace checks). Owner, Admin and Sales; a Viewer reads no money. */
export default async function DuesPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/dues">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const raw = await searchParams;
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
  const lang = await getLang();
  const words = dueWords(lang);
  if (tenant.role === "viewer") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={words["nav.item.dues"]} message={words["due.viewer"]} />;
  const rawAfter = pick(raw.after);
  let page = null;
  try {
    page = await getLedgerSummary(user.accessToken, tenantId, { party: "company", after: rawAfter && rawAfter.length <= MAX_CURSOR ? rawAfter : null });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <DuesView base={`/app/tenants/${tenantId}`} words={words} rows={page?.items ?? null} more={page?.next_cursor ?? null} />
    </main>
  );
}
