import { notFound, redirect } from "next/navigation";

import { RemindButton } from "@/components/v2/app/money/RemindButton";
import { MoneyView } from "@/components/v2/app/money/MoneyView";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { WRITERS } from "@/components/v2/app/nav";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getMoneySummary, type MoneySummary } from "@/lib/api/money";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";
import { appV4 } from "@/lib/screens/flag";

import { remindAction } from "./remind-actions";

export const metadata = { title: `Money · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/money (app v4 part 6; only with APP_V4, else 404): Sales > Money, from C1's `GET /money/summary`: what customers owe, what is overdue, what was paid this month, and who owes most, with Remind (a draft for the owner's
 * OK, never sent). For the Owner, Admin and Sales (a Viewer reads no money); only a business type with the ledger (module `dues`) has any, the module guard of the workspace checks that through the Money menu entry.
 */
export default async function MoneyPage({ params }: PageProps<"/app/tenants/[tenantId]/money">) {
  if (!appV4()) notFound();
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
  const lang = await getLang();
  const w = wordsFor(lang, ["mo.", "nav.item.m-money"]);
  if (!(WRITERS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={w["nav.item.m-money"]} message={w["mo.viewer"]} />;
  const pack = await readPackCached(user.accessToken, tenantId).catch(() => null);
  let summary: MoneySummary | null = null;
  try {
    summary = await getMoneySummary(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    // anything else: the page says the summary could not be read
  }
  const base = `/app/tenants/${tenantId}`;
  const when = (day: string) => new Intl.DateTimeFormat(`${lang}-IN`, { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00+05:30`));
  const campaigns = hasModule(pack, "campaigns") ? `${base}/campaigns` : null;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={w["nav.item.m-money"]} sub={w["mo.sub"]} />
      <div className="mt-4">
        <MoneyView
          summary={summary}
          w={w}
          base={base}
          when={when}
          duesHref={hasModule(pack, "dues") ? `${base}/dues` : null}
          remind={(row) => <RemindButton w={w} campaignsHref={campaigns} row={{ companyId: row.companyId, contactId: row.contactId, name: row.name }} remind={remindAction.bind(null, tenantId)} />}
        />
      </div>
    </main>
  );
}
